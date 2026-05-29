import nodemailer, { type Transporter } from "nodemailer";
import { db, mailConfigTable, pool, tenantSchemaContext } from "@workspace/db";

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

async function getPublicMailConfigRow() {
  return (await pool.query<{
    smtp_host: string | null;
    smtp_port: number;
    smtp_user: string | null;
    smtp_pass: string | null;
    from_email: string | null;
    from_name: string;
    secure: boolean;
    enabled: boolean;
  }>("select smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name, secure, enabled from public.mail_config order by id asc limit 1")).rows[0] ?? null;
}

export async function getMailConfig(preferPublic = false): Promise<ResolvedMailConfig | null> {
  const fallbackRow = preferPublic ? await getPublicMailConfigRow() : null;
  if (fallbackRow) {
    return {
      smtpHost: fallbackRow.smtp_host ?? "",
      smtpPort: fallbackRow.smtp_port ?? 587,
      smtpUser: fallbackRow.smtp_user ?? null,
      smtpPass: fallbackRow.smtp_pass ?? null,
      fromEmail: fallbackRow.from_email ?? "",
      fromName: fallbackRow.from_name ?? "Platr",
      secure: fallbackRow.secure,
      enabled: fallbackRow.enabled,
    };
  }

  const [row] = await db.select().from(mailConfigTable);
  const tenantFallbackRow = (!row || !row.smtpHost || !row.fromEmail) && tenantSchemaContext.getStore()
    ? await getPublicMailConfigRow()
    : null;
  const active = row && row.smtpHost && row.fromEmail ? row : tenantFallbackRow;
  if (!active) return null;
  return {
    smtpHost: active.smtpHost ?? active.smtp_host ?? "",
    smtpPort: active.smtpPort ?? active.smtp_port ?? 587,
    smtpUser: active.smtpUser ?? active.smtp_user ?? null,
    smtpPass: active.smtpPass ?? active.smtp_pass ?? null,
    fromEmail: active.fromEmail ?? active.from_email ?? "",
    fromName: active.fromName ?? active.from_name ?? "Platr",
    secure: active.secure,
    enabled: active.enabled,
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
  preferPublicConfig?: boolean;
}): Promise<SendResult> {
  const cfg = await getMailConfig(!!opts.preferPublicConfig);
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
