import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./common/logger/logger";
import { prisma } from "./prisma/client";

const app = createApp();

async function boot() {
  await prisma.$connect();

  app.listen(env.PORT, () => {
    logger.info(`RentSure API running on http://localhost:${env.PORT}`);
  });
}

boot().catch((error) => {
  logger.error({ err: error }, "Failed to boot API");
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
