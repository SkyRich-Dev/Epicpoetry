import path from "path";

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const rawPort = process.env["API_PORT"] ?? process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "API_PORT or PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const [{ default: app }, { logger }, { seed }] = await Promise.all([
  import("./app"),
  import("./lib/logger"),
  import("./seed"),
]);

seed().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
