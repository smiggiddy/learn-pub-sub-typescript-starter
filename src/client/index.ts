import amqp from "amqplib";
import { clientWelcome } from "../internal/gamelogic/gamelogic.js";
import { declareAndBind } from "../internal/pubsub/api.js";
import { PauseKey } from "../internal/routing/routing.js";

async function main() {
  const rabbitConnString = process.env.NODE_ENV === 'local' ? "amqp://guest:guest@localhost:5672/" : "amqp://default_user_9ezjAPRkTII4zNCNVm1:i5a8KsnTFR9HPzk5JIVjo_SuhujOxN4j@smig-ca01.lab.smig.tech:5672/"
  console.log("Starting Peril client...");

  const conn = await amqp.connect(rabbitConnString);
  const username = await clientWelcome();

  try {
    declareAndBind(conn, 'peril_direct', `pause.${username}`, PauseKey, 'transient');
  } catch (err) {
    console.error(`Error creating queue`);
  }


}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
