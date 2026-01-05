import amqp, { type ConfirmChannel } from "amqplib";
import {
  clientWelcome,
  getInput,
  printClientHelp,
  commandStatus,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import {
  GameState,
  type PlayingState,
} from "../internal/gamelogic/gamestate.js";
import {
  commandMove,
  handleMove,
  MoveOutcome,
} from "../internal/gamelogic/move.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import {
  AckType,
  SimpleQueueType,
  declareAndBind,
  publishJSON,
  subscribeJSON,
  publishMsgPack,
  subsribeMsgPack,
} from "../internal/pubsub/api.js";
import {
  ArmyMovesPrefix,
  ExchangePerilDirect,
  ExchangePerilTopic,
  ExchangePerilDlq,
  PauseKey,
  WarRecognitionsPrefix,
  GameLogSlug,
} from "../internal/routing/routing.js";

import type {
  ArmyMove,
  Player,
  RecognitionOfWar,
} from "../internal/gamelogic/gamedata.js";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";

import type { GameLog } from "../internal/gamelogic/logs.js";

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

function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return AckType.Ack;
  };
}

function handlerWar(
  gs: GameState,
  ch: ConfirmChannel,
): (war: RecognitionOfWar) => Promise<AckType> {
  return async (war: RecognitionOfWar): Promise<AckType> => {
    try {
      const outcome = handleWar(gs, war);

      switch (outcome.result) {
        case WarOutcome.NotInvolved:
          return AckType.NackRequeue;
        case WarOutcome.NoUnits:
          return AckType.NackDiscard;
        case WarOutcome.OpponentWon:
          try {
            publishGameLog(
              ch,
              `${outcome.winner} won a war against ${outcome.loser}`,
              gs.getUsername(),
            );
            return AckType.Ack;
          } catch (err) {
            console.log(`error: ${err}`);
            return AckType.NackRequeue;
          }
        case WarOutcome.YouWon:
          try {
            publishGameLog(
              ch,
              `${outcome.winner} won a war against ${outcome.loser}`,
              gs.getUsername(),
            );
            return AckType.Ack;
          } catch (err) {
            console.log(`error: ${err}`);
            return AckType.NackRequeue;
          }
        case WarOutcome.Draw:
          try {
            publishGameLog(
              ch,
              `A war between ${outcome.attacker} and ${outcome.defender} resulted in a draw`,
              gs.getUsername(),
            );
            return AckType.Ack;
          } catch (err) {
            console.log(`error: ${err}`);
            return AckType.NackRequeue;
          }
        default:
          const unreachable: never = outcome;
          console.log(`error unreachable: ${unreachable}`);
          return AckType.NackRequeue;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

function handlerMove(
  gs: GameState,
  ch: ConfirmChannel,
): (ps: PlayingState) => AckType {
  return async (move: ArmyMove): Promise<AckType> => {
    try {
      const outcome = handleMove(gs, move);
      switch (outcome) {
        case MoveOutcome.Safe:
          return AckType.Ack;
        case MoveOutcome.MakeWar:
          const recongition: RecognitionOfWar = {
            attacker: move.player,
            defender: gs.getPlayerSnap(),
          };

          try {
            await publishJSON(
              ch,
              ExchangePerilTopic,
              `${WarRecognitionsPrefix}.${gs.getUsername()}`,
              recongition,
            );
            return AckType.Ack;
          } catch (err) {
            console.error("Error publishing war recognition", err);
            return AckType.NackRequeue;
          }

        default:
          return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

async function main() {
  const rabbitConnString =
    process.env.NODE_ENV === "local"
      ? "amqp://guest:guest@localhost:5672/"
      : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/";
  console.log("Starting Peril client...");

  const conn = await amqp.connect(rabbitConnString);
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
