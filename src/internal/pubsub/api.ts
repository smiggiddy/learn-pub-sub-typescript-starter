import type { ConfirmChannel } from "amqplib";
import { encode, decode } from "@msgpack/msgpack";
import { ExchangePerilDlq } from "../routing/routing.js";

export enum AckType {
  Ack,
  NackDiscard,
  NackRequeue,
}

export enum SimpleQueueType {
  "durable",
  "transient",
}

export function publishMsgPack<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T,
): Promise<void> {
  const encoded: Uint8Array = encode(value);
  const buff = Buffer.from(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  );
  return new Promise((resolve, reject) => {
    ch.publish(
      exchange,
      routingKey,
      buff,
      { contentType: "application/x-msgpack" },
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
          ? {
              durable: false,
              autoDelete: true,
              exclusive: true,
              arguments: {
                "x-dead-letter-exchange": ExchangePerilDlq,
                "x-dead-letter-routing-key": queueName,
              },
            }
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
  handler: (data: T) => Promise<AckType> | AckType,
): Promise<void> {
  await subscribe(conn, exchange, queueName, key, queueType, handler, (d) => {
    const data = d.toString("utf8");
    return JSON.parse(data);
  });
}

export async function subsribeMsgPack<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType, // an enum to represent "durable" or "transient"
  handler: (data: T) => Promise<AckType> | AckType,
): Promise<void> {
  await subscribe(conn, exchange, queueName, key, queueType, handler, (d) => {
    const data = decode(d);
    console.log(data);
    return data;
  });
}

export async function subscribe<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
  unmarshaller: (data: Buffer) => T,
): Promise<void> {
  let ch: amqp.ChannelModel;

  let queue: amqp.QueueModel;
  try {
    [ch, queue] = await declareAndBind(
      conn,
      exchange,
      queueName,
      routingKey,
      simpleQueueType,
    );
  } catch (err) {
    console.error(err);
  }

  await ch.prefetch(10);
  await ch.consume(queue, async (message: amqp.ConsumeMessage | null) => {
    if (!message) return;

    const data = unmarshaller(message.content);
    const result = await handler(data);

    switch (result) {
      case AckType.Ack:
        ch.ack(message);
        break;
      case AckType.NackDiscard:
        ch.nack(message, false, false);
        break;
      case AckType.NackRequeue:
        ch.nack(message, false, true);
        break;
      default:
        console.log("something went wrong with this");
        process.stdout.write("> ");
        return;
    }
  });
}
