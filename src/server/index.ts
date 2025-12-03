import amqp from "amqplib"
import type { PlayingState } from "../internal/gamelogic/gamestate.js";
import { publishJSON } from "../internal/pubsub/api.js";
import { ExchangePerilDirect, PauseKey } from "../internal/routing/routing.js";




const rabbitConnString = process.env.NODE_ENV === 'local' ? "amqp://guest:guest@localhost:5672/" : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/"

async function main() {
  console.log("Starting Peril server...");
  const conn = await amqp.connect(rabbitConnString)
  console.log("connected to rabbit mq")
  const channel = await conn.createConfirmChannel()
  const playingState: PlayingState = {
    isPaused: true
  }
  process.on('SIGINT', () => {
    conn.close()
    console.log("RabbitMQ Connection Closed")
    process.exit(0)
  })


  try {
    console.log(ExchangePerilDirect, PauseKey, playingState)
    await publishJSON(channel, ExchangePerilDirect, PauseKey, playingState)

  } catch (err) {
    console.error("Error publishing message", err)
  }



}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
