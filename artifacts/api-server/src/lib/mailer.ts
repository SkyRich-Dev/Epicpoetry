import nodemailer, { type Transporter } from "nodemailer";
import { db, mailConfigTable } from "@workspace/db";

let cachedTransporter: Transporter | null = null;
let cachedKey = "";

export interface ResolvedMailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  fromEmail: string;
  fromName: string;
  secure: boolean;
  enabled: boolean;
}

export async function getMailConfig(): Promise<ResolvedMailConfig | null> {
  const [row] = await db.select().from(mailConfigTable);
  if (!row) return null;
  if (!row.smtpHost || !row.fromEmail) return null;
  return {
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser,
    smtpPass: row.smtpPass,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    secure: row.secure,
    enabled: row.enabled,
  };
}

function buildKey(c: ResolvedMailConfig) {
  return [c.smtpHost, c.smtpPort, c.smtpUser ?? "", c.smtpPass ?? "", c.secure ? "1" : "0"].join("|");
}

export async function getTransporter(cfg: ResolvedMailConfig): Promise<Transporter> {
  const key = buildKey(cfg);
  if (cachedTransporter && cachedKey === key) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.secure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass ?? "" } : undefined,
  });
  cachedKey = key;
  return cachedTransporter;
}

export function invalidateTransporter() {
  cachedTransporter = null;
  cachedKey = "";
}

export interface SendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

export async function sendMail(opts: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const cfg = await getMailConfig();
  if (!cfg) return { ok: false, error: "Mail is not configured. Set SMTP host and from-email in Mail Setup." };
  if (!cfg.enabled) return { ok: false, error: "Mail sending is disabled. Enable it in Mail Setup." };
  if (!opts.to.length) return { ok: false, error: "No recipients" };
  try {
    const t = await getTransporter(cfg);
    const info = await t.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: opts.to.join(", "),
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    invalidateTransporter();
    return { ok: false, error: e?.message || String(e) };
  }
}
