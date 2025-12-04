import amqp from "amqplib";
import {
  clientWelcome,
  getInput,
  printClientHelp,
  commandStatus,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandMove } from "../internal/gamelogic/move.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { declareAndBind } from "../internal/pubsub/api.js";
import { PauseKey } from "../internal/routing/routing.js";

async function main() {
  const rabbitConnString =
    process.env.NODE_ENV === "local"
      ? "amqp://guest:guest@localhost:5672/"
      : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/";
  console.log("Starting Peril client...");

  const conn = await amqp.connect(rabbitConnString);
  const username = await clientWelcome();

  try {
    declareAndBind(
      conn,
      "peril_direct",
      `pause.${username}`,
      PauseKey,
      "transient",
    );
  } catch (err) {
    console.error(`Error creating queue`);
  }
  const gs = new GameState(username);

  let stopGame = false;

  while (!stopGame) {
    printClientHelp();
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
        try {
          commandMove(gs, input);
        } catch (err) {
          console.log(err);
        }
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
        continue;
      default:
        console.log("enter a valid command");
        printClientHelp();
        continue;
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
