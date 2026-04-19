import path from "path";

const savedEnv: Record<string, string> = {};
for (const key of ["PORT", "DATABASE_URL", "SESSION_SECRET"]) {
  if (process.env[key]) savedEnv[key] = process.env[key]!;
}

try { process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env")); } catch {}

for (const [key, val] of Object.entries(savedEnv)) {
  process.env[key] = val;
}

const rawPort = process.env["PORT"] ?? process.env["API_PORT"];

if (!rawPort) {
  throw new Error(
    "API_PORT or PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const [{ default: app }, { logger }, { seed }, { startNotificationScheduler }] = await Promise.all([
  import("./app"),
  import("./lib/logger"),
  import("./seed"),
  import("./lib/notificationScheduler"),
]);

seed().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startNotificationScheduler();
  });
}).catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
