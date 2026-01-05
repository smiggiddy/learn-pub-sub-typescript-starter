import amqp, { type ConfirmChannel } from "amqplib";
import {
  clientWelcome,
  getInput,
  printClientHelp,
  commandStatus,
  printQuit,
  getMaliciousLog,
} from "../internal/gamelogic/gamelogic.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandMove } from "../internal/gamelogic/move.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import {
  SimpleQueueType,
  declareAndBind,
  publishJSON,
  subscribeJSON,
  publishMsgPack,
} from "../internal/pubsub/api.js";
import {
  ArmyMovesPrefix,
  ExchangePerilDirect,
  ExchangePerilTopic,
  PauseKey,
  WarRecognitionsPrefix,
  GameLogSlug,
} from "../internal/routing/routing.js";

import type { GameLog } from "../internal/gamelogic/logs.js";
import {
  handlerPause,
  handlerMove,
  handlerWar,
  SpamHandler,
} from "../internal/handlers/handlers.js";

export function publishGameLog(
  ch: ConfirmChannel,
  value: string,
  player: string,
): Promise<void> {
  const gl: GameLog = {
    username: player,
    message: value,
    currentTime: new Date(),
  };
  return publishMsgPack(ch, ExchangePerilTopic, `${GameLogSlug}.${player}`, gl);
}

async function main() {
  const rabbitConnString =
    process.env.NODE_ENV === "local"
      ? "amqp://guest:guest@localhost:5672/"
      : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/";
  console.log("Starting Peril client...");

  const conn = await amqp.connect(rabbitConnString);

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

  const ch = await conn.createConfirmChannel();
  const username = await clientWelcome();

  const gs = new GameState(username);

  let stopGame = false;

  try {
    await declareAndBind(
      conn,
      ExchangePerilTopic,
      `${ArmyMovesPrefix}.${username}`,
      `${ArmyMovesPrefix}.*`,
      SimpleQueueType.transient,
    );
    await declareAndBind(
      conn,
      ExchangePerilTopic,
      `${WarRecognitionsPrefix}`,
      `${WarRecognitionsPrefix}.*`,
      SimpleQueueType.durable,
    );
  } catch (err) {
    console.error(`Error creating queue`, err);
  }
  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    `${ArmyMovesPrefix}.${username}`,
    `${ArmyMovesPrefix}.*`,
    SimpleQueueType.transient,
    handlerMove(gs, ch),
  );

  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    `${WarRecognitionsPrefix}`,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.durable,
    handlerWar(gs, ch),
  );
  await subscribeJSON(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.transient,
    handlerPause(gs),
  );

  while (!stopGame) {
    // printClientHelp();
    const input = await getInput();

    switch (input[0]) {
      case "spawn":
        try {
          commandSpawn(gs, input);
        } catch (err) {
          console.log(err);
        }
        continue;
      case "move":
        const move = commandMove(gs, input);
        publishJSON(
          ch,
          ExchangePerilTopic,
          `${ArmyMovesPrefix}.${username}`,
          move,
        );

        continue;
      case "status":
        commandStatus(gs);
        continue;
      case "help":
        printClientHelp();
        continue;
      case "quit":
        printQuit();
        stopGame = true;
        break;
      case "spam":
        if (input.length < 2) {
          console.log("please enter spam with a valid length");
          continue;
        }
        SpamHandler(ch, Number(input[1]), gs.getUsername());
        continue;
      default:
        console.log("enter a valid command");
        printClientHelp();
        continue;
    }
  }
  if (stopGame) {
    await conn.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
