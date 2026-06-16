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

type PublicMailConfigRow = {
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_pass: string | null;
  from_email: string | null;
  from_name: string;
  secure: boolean;
  enabled: boolean;
};

type TenantMailConfigRow = typeof mailConfigTable.$inferSelect;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvMailConfig(): ResolvedMailConfig | null {
  const smtpHost = process.env.SMTP_HOST?.trim() || "";
  const smtpPort = parseNumber(process.env.SMTP_PORT, 587);
  const fromEmail = process.env.SMTP_FROM?.trim() || "";
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Platr";
  const smtpUser = process.env.SMTP_USER?.trim() || null;
  const smtpPass = process.env.SMTP_PASS?.trim() || null;
  const enabled = Boolean(smtpHost && fromEmail);
  if (!enabled) return null;
  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
    secure: parseBoolean(process.env.SMTP_SECURE, smtpPort === 465),
    enabled: true,
  };
}

async function getPublicMailConfigRow() {
  return (await pool.query<PublicMailConfigRow>("select smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name, secure, enabled from public.mail_config order by id asc limit 1")).rows[0] ?? null;
}

function toResolvedMailConfig(row: TenantMailConfigRow | PublicMailConfigRow): ResolvedMailConfig {
  if ("smtpHost" in row) {
    return {
      smtpHost: row.smtpHost ?? "",
      smtpPort: row.smtpPort ?? 587,
      smtpUser: row.smtpUser ?? null,
      smtpPass: row.smtpPass ?? null,
      fromEmail: row.fromEmail ?? "",
      fromName: row.fromName ?? "Platr",
      secure: row.secure,
      enabled: row.enabled,
    };
  }

  return {
    smtpHost: row.smtp_host ?? "",
    smtpPort: row.smtp_port ?? 587,
    smtpUser: row.smtp_user ?? null,
    smtpPass: row.smtp_pass ?? null,
    fromEmail: row.from_email ?? "",
    fromName: row.from_name ?? "Platr",
    secure: row.secure,
    enabled: row.enabled,
  };
}

export async function getMailConfig(preferPublic = false): Promise<ResolvedMailConfig | null> {
  const envConfig = getEnvMailConfig();
  if (envConfig) {
    return envConfig;
  }

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
  return toResolvedMailConfig(active);
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
