import { db, notificationRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isDue } from "./notificationTypes";
import { runRule } from "../routes/notifications";
import { logger } from "./logger";

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startNotificationScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const rules = await db.select().from(notificationRulesTable).where(eq(notificationRulesTable.enabled, true));
      const now = new Date();
      for (const rule of rules) {
        if (isDue(rule.schedule, rule.lastRunAt, now)) {
          logger.info({ ruleId: rule.id, type: rule.type }, "notification: firing rule");
          try {
            await runRule(rule, "scheduler");
          } catch (e) {
            logger.error({ err: e, ruleId: rule.id }, "notification: rule failed");
          }
        }
      }
    } catch (e) {
      logger.error({ err: e }, "notification scheduler tick failed");
    }
  };
  // First tick after 30s to avoid racing seed; then every 60s.
  setTimeout(() => { void tick(); timer = setInterval(() => void tick(), 60_000); }, 30_000);
  logger.info("notification scheduler started");
}

export function stopNotificationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
