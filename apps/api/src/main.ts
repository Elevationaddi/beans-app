import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { EnvValidationError, loadEnv } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT);
  Logger.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`, "Bootstrap");
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
  } else {
    console.error("API failed to start", error);
  }
  process.exit(1);
});
