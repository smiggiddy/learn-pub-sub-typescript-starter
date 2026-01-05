import { type ConfirmChannel } from "amqplib";
import { type PlayingState, GameState } from "../gamelogic/gamestate.js";
import { AckType, publishJSON, publishMsgPack } from "../pubsub/api.js";
import { handlePause } from "../gamelogic/pause.js";
import { MoveOutcome, handleMove } from "../gamelogic/move.js";
import { type RecognitionOfWar, type ArmyMove } from "../gamelogic/gamedata.js";
import {
  ExchangePerilTopic,
  WarRecognitionsPrefix,
} from "../routing/routing.js";
import { handleWar, WarOutcome, type WarResolution } from "../gamelogic/war.js";

import { publishGameLog } from "../../client/index.js";
import { getMaliciousLog } from "../gamelogic/gamelogic.js";

export function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return AckType.Ack;
  };
}

export function handlerMove(
  gs: GameState,
  ch: ConfirmChannel,
): (move: ArmyMove) => Promise<AckType> {
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

export function handlerWar(
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

export function SpamHandler(ch: ConfirmChannel, input: Number, player: string) {
  for (let i = 0; i < input; i++) {
    const log = getMaliciousLog();
    publishGameLog(ch, log, player);
  }
}
