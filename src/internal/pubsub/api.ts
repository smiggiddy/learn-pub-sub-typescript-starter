import type { ConfirmChannel } from "amqplib";

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
  return new Promise((resolve, reject) => {
    const options =
      queueType === "durable"
        ? { durable: true, arguments: {} }
        : queueType === "transient"
          ? { durable: false, autoDelete: true, exclusive: true, arguments: {} }
          : null;
    const queue = ch.assertQueue(queueName, options, (err) => {
      if (err !== null) {
        reject(new Error("Error During queue creation", err));
      }
    });

    ch.bindQueue(queueName, exchange, key, {}, (err) => {
      if (err !== null) {
        reject(new Error("error binding queue"));
      } else {
        resolve([ch, queue]);
      }
    });
  });
}
