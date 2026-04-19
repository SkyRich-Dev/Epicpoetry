import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, mailConfigTable, notificationRulesTable, notificationLogsTable } from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { sendMail, getMailConfig, invalidateTransporter } from "../lib/mailer";
import { ALERT_TYPES, SCHEDULES, isValidSchedule, isValidType, buildAlertContent } from "../lib/notificationTypes";

const router: IRouter = Router();

const MASK = "********";

function maskConfig(row: typeof mailConfigTable.$inferSelect | undefined) {
  if (!row) {
    return {
      id: null,
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "",
      smtpPass: "",
      hasPassword: false,
      fromEmail: "",
      fromName: "Platr",
      secure: false,
      enabled: false,
    };
  }
  return {
    id: row.id,
    smtpHost: row.smtpHost ?? "",
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser ?? "",
    smtpPass: row.smtpPass ? MASK : "",
    hasPassword: !!row.smtpPass,
    fromEmail: row.fromEmail ?? "",
    fromName: row.fromName,
    secure: row.secure,
    enabled: row.enabled,
  };
}

router.get("/mail-config", authMiddleware, async (_req, res) => {
  const [row] = await db.select().from(mailConfigTable);
  res.json(maskConfig(row));
});

router.put("/mail-config", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, fromName, secure, enabled } = req.body || {};
  const [existing] = await db.select().from(mailConfigTable);
  const newPass = typeof smtpPass === "string" && smtpPass !== MASK ? smtpPass : existing?.smtpPass ?? null;
  const values = {
    smtpHost: typeof smtpHost === "string" ? smtpHost.trim() : existing?.smtpHost ?? null,
    smtpPort: Number.isFinite(Number(smtpPort)) ? Number(smtpPort) : existing?.smtpPort ?? 587,
    smtpUser: typeof smtpUser === "string" ? smtpUser.trim() : existing?.smtpUser ?? null,
    smtpPass: newPass,
    fromEmail: typeof fromEmail === "string" ? fromEmail.trim() : existing?.fromEmail ?? null,
    fromName: typeof fromName === "string" && fromName.trim() ? fromName.trim() : existing?.fromName ?? "Platr",
    secure: !!secure,
    enabled: !!enabled,
  };
  if (existing) {
    await db.update(mailConfigTable).set(values).where(eq(mailConfigTable.id, existing.id));
  } else {
    await db.insert(mailConfigTable).values(values);
  }
  invalidateTransporter();
  const [row] = await db.select().from(mailConfigTable);
  res.json(maskConfig(row));
});

router.post("/mail-config/test", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { to } = req.body || {};
  if (!to || typeof to !== "string") {
    res.status(400).json({ error: "Recipient email required" });
    return;
  }
  const cfg = await getMailConfig();
  if (!cfg) { res.status(400).json({ error: "Mail not configured" }); return; }
  const result = await sendMail({
    to: [to],
    subject: "[Platr] Test email",
    html: `<div style="font-family:Inter,Arial,sans-serif;padding:16px"><h2 style="color:#E8722C">Mail setup OK</h2><p>This is a test email from Platr.</p><p>If you received this, your SMTP configuration is working.</p></div>`,
    text: "Mail setup OK — this is a test email from Platr.",
  });
  await db.insert(notificationLogsTable).values({
    ruleId: null,
    ruleName: "Mail config test",
    type: "test",
    status: result.ok ? "sent" : "failed",
    subject: "[Platr] Test email",
    recipientsCount: 1,
    recipients: [to],
    error: result.error ?? null,
    trigger: "manual",
  });
  if (!result.ok) { res.status(500).json({ error: result.error }); return; }
  res.json({ ok: true, messageId: result.messageId });
});

router.get("/notification-types", authMiddleware, (_req, res) => {
  res.json({ types: ALERT_TYPES, schedules: SCHEDULES });
});

router.get("/notification-rules", authMiddleware, async (_req, res) => {
  const rows = await db.select().from(notificationRulesTable).orderBy(desc(notificationRulesTable.createdAt));
  res.json(rows);
});

router.post("/notification-rules", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { name, type, schedule, recipients, threshold, enabled } = req.body || {};
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
  if (!type || !isValidType(type)) { res.status(400).json({ error: "Invalid alert type" }); return; }
  const sch = typeof schedule === "string" && isValidSchedule(schedule) ? schedule : "daily_morning";
  const recs = Array.isArray(recipients) ? recipients.filter((r) => typeof r === "string" && r.includes("@")) : [];
  const [row] = await db.insert(notificationRulesTable).values({
    name: name.trim(),
    type,
    schedule: sch,
    recipients: recs,
    threshold: threshold && typeof threshold === "object" ? threshold : null,
    enabled: enabled !== false,
  }).returning();
  res.status(201).json(row);
});

router.patch("/notification-rules/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(notificationRulesTable).where(eq(notificationRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }
  const { name, type, schedule, recipients, threshold, enabled } = req.body || {};
  const updates: any = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof type === "string" && isValidType(type)) updates.type = type;
  if (typeof schedule === "string" && isValidSchedule(schedule)) updates.schedule = schedule;
  if (Array.isArray(recipients)) updates.recipients = recipients.filter((r) => typeof r === "string" && r.includes("@"));
  if (threshold !== undefined) updates.threshold = threshold && typeof threshold === "object" ? threshold : null;
  if (typeof enabled === "boolean") updates.enabled = enabled;
  if (Object.keys(updates).length > 0) {
    await db.update(notificationRulesTable).set(updates).where(eq(notificationRulesTable.id, id));
  }
  const [row] = await db.select().from(notificationRulesTable).where(eq(notificationRulesTable.id, id));
  res.json(row);
});

router.delete("/notification-rules/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(notificationRulesTable).where(eq(notificationRulesTable.id, id));
  res.json({ success: true });
});

router.post("/notification-rules/:id/run-now", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [rule] = await db.select().from(notificationRulesTable).where(eq(notificationRulesTable.id, id));
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  const result = await runRule(rule, "manual");
  res.json(result);
});

router.get("/notification-logs", authMiddleware, async (_req, res) => {
  const rows = await db.select().from(notificationLogsTable).orderBy(desc(notificationLogsTable.sentAt)).limit(200);
  res.json(rows);
});

export async function runRule(rule: typeof notificationRulesTable.$inferSelect, trigger: "scheduler" | "manual" = "scheduler") {
  const recipients = Array.isArray(rule.recipients) ? rule.recipients : [];
  if (recipients.length === 0) {
    const log = { ruleId: rule.id, ruleName: rule.name, type: rule.type, status: "skipped", subject: null, recipientsCount: 0, recipients: [], error: "No recipients", trigger };
    await db.insert(notificationLogsTable).values(log);
    await db.update(notificationRulesTable).set({ lastRunAt: new Date(), lastStatus: "skipped", lastError: "No recipients" }).where(eq(notificationRulesTable.id, rule.id));
    return { ok: false, error: "No recipients" };
  }
  let content;
  try {
    content = await buildAlertContent(rule.type, rule.threshold ?? null);
  } catch (e: any) {
    const err = e?.message || String(e);
    await db.insert(notificationLogsTable).values({ ruleId: rule.id, ruleName: rule.name, type: rule.type, status: "failed", subject: null, recipientsCount: recipients.length, recipients, error: err, trigger });
    await db.update(notificationRulesTable).set({ lastRunAt: new Date(), lastStatus: "failed", lastError: err }).where(eq(notificationRulesTable.id, rule.id));
    return { ok: false, error: err };
  }
  const result = await sendMail({ to: recipients, subject: content.subject, html: content.html, text: content.text });
  await db.insert(notificationLogsTable).values({
    ruleId: rule.id,
    ruleName: rule.name,
    type: rule.type,
    status: result.ok ? "sent" : "failed",
    subject: content.subject,
    recipientsCount: recipients.length,
    recipients,
    error: result.error ?? null,
    trigger,
  });
  await db.update(notificationRulesTable).set({
    lastRunAt: new Date(),
    lastStatus: result.ok ? "sent" : "failed",
    lastError: result.error ?? null,
  }).where(eq(notificationRulesTable.id, rule.id));
  return result;
}

export default router;
