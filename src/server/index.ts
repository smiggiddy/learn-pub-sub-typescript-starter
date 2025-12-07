import amqp from "amqplib";
import { getInput, printServerHelp } from "../internal/gamelogic/gamelogic.js";
import type { PlayingState } from "../internal/gamelogic/gamestate.js";
import { publishJSON } from "../internal/pubsub/api.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  PauseKey,
} from "../internal/routing/routing.js";
import { declareAndBind } from "../internal/pubsub/api.js";

const rabbitConnString =
  process.env.NODE_ENV === "local"
    ? "amqp://guest:guest@localhost:5672/"
    : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/";

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
      "game_logs",
      "game_logs.*",
      "durable",
    );
  } catch (err) {
    console.error(`Error creating queue`, err);
  }

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

  // try {
  //   console.log(ExchangePerilDirect, PauseKey, playingState)
  //   await publishJSON(channel, ExchangePerilDirect, PauseKey, playingState)
  //
  // } catch (err) {
  //   console.error("Error publishing message", err)
  // }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
