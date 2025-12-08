import type { ConfirmChannel } from "amqplib";
import { ExchangePerilDlq } from "../routing/routing.js";

export enum AckType {
  Ack,
  NackDiscard,
  NackRequeue,
}

export function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T,
): Promise<void> {
  const buff = Buffer.from(JSON.stringify(value));

  return new Promise((resolve, reject) => {
    ch.publish(
      exchange,
      routingKey,
      buff,
      { contentType: "application/json" },
      (err) => {
        if (err !== null) {
          reject(new Error(`Rabbit MQ Message ${err}`));
        } else {
          resolve();
        }
      },
    );
  });
}

export async function declareAndBind(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
): Promise<[Channel, amqp.Replies.AssertQueue]> {
  const ch = await conn.createConfirmChannel();
  return new Promise(async (resolve, reject) => {
    let options =
      queueType === "durable"
        ? { durable: true, arguments: { deadLetterExchange: ExchangePerilDlq } }
        : queueType === "transient"
          ? { durable: false, autoDelete: true, exclusive: true, arguments: { 'x-dead-letter-exchange': ExchangePerilDlq, 'x-dead-letter-routing-key': queueName } }
          : null;
    const queue = ch.assertQueue(queueName, options, (err) => {
      if (err !== null) {
        reject(new Error("Error During queue creation", err));
      }
    });
    ch.bindQueue(queueName, exchange, key, {}, (err) => {
      if (err !== null) {
        reject(new Error("error binding queue"));
      }
    });
    resolve([ch, queue.queue]);
  });
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType, // an enum to represent "durable" or "transient"
  handler: (data: T) => AckType,
): Promise<void> {
  let ch: amqp.ChannelModel;

  let queue: amqp.QueueModel;
  try {
    [ch, queue] = await declareAndBind(
      conn,
      exchange,
      queueName,
      key,
      queueType,
    );
  } catch (err) {
    console.error(err);
  }
  await ch.consume(queue, (message: amqp.ConsumeMessage | null) => {
    if (!message) return;

    const buf = message.content.toString("utf8");
    const json = JSON.parse(buf);
    const result = handler(json);

    switch (result) {
      case AckType.Ack:
        ch.ack(message);
        process.stdout.write("Ack\n");
        process.stdout.write("> ");
        break;
      case AckType.NackDiscard:
        ch.nack(message, false, false);
        process.stdout.write("discarding message failed nack\n");
        process.stdout.write("> ");
        break;
      case AckType.NackRequeue:
        ch.nack(message, false, true);
        process.stdout.write("nack, requeuing message\n");
        process.stdout.write("> ");
        break;
      default:
        console.log("something went wrong with this");
        process.stdout.write("> ");
        return
    }
  });
}
