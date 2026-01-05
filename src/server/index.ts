import amqp from "amqplib";
import { getInput, printServerHelp } from "../internal/gamelogic/gamelogic.js";
import { publishJSON, subsribeMsgPack } from "../internal/pubsub/api.js";
import { SimpleQueueType, AckType } from "../internal/pubsub/api.js";
import { GameLogSlug } from "../internal/routing/routing.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  PauseKey,
} from "../internal/routing/routing.js";
import { declareAndBind } from "../internal/pubsub/api.js";
import { writeLog, type GameLog } from "../internal/gamelogic/logs.js";

const rabbitConnString =
  process.env.NODE_ENV === "local"
    ? "amqp://guest:guest@localhost:5672/"
    : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/";

function handlerLog(d: GameLog): AckType {
  writeLog(d);
  return AckType.Ack;
}

async function main() {
  console.log("Starting Peril server...");

  const conn = await amqp.connect(rabbitConnString);
  console.log("connected to rabbit mq");

  process.on("SIGINT", () => {
    conn.close();
    console.log("RabbitMQ Connection Closed");
    process.exit(0);
  });
  process.on("SIGINT", () => {
    conn.close();
    console.log("RabbitMQ Connection Closed");
    process.exit(0);
  });

  const channel = await conn.createConfirmChannel();
  await channel.assertExchange(ExchangePerilDirect, "direct");
  await channel.assertExchange(ExchangePerilTopic, "topic");

  try {
    await declareAndBind(
      conn,
      ExchangePerilTopic,
      GameLogSlug,
      `${GameLogSlug}.*`,
      SimpleQueueType.durable,
    );
  } catch (err) {
    console.error(`Error creating queue`, err);
  }

  await subsribeMsgPack(
    conn,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.durable,
    handlerLog,
  );

  printServerHelp();

  let stopGame = false;
  while (!stopGame) {
    const input = await getInput();

    for (const item of input) {
      switch (item) {
        case "pause":
          console.log("Sending a pause message", item);
          await publishJSON(channel, ExchangePerilDirect, PauseKey, {
            isPaused: true,
          });
          continue;

        case "resume":
          console.log("Sending a resume message", item);
          await publishJSON(channel, ExchangePerilDirect, PauseKey, {
            isPaused: false,
          });
          continue;
        case "quit":
          console.log("Exiting the game", item);
          stopGame = true;
          break;
        case "":
          console.log("Please enter a valid command. Options are:");
          printServerHelp();
          continue;
        default:
          continue;
      }
    }
  }

  if (stopGame) {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
