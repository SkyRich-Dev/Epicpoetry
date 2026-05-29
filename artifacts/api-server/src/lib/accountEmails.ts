import type { Request } from "express";
import { sendMail } from "./mailer";
import { resolveSiteUrl, type PasswordTokenPurpose } from "./passwordAuth";

type SetupEmailArgs = {
  req?: Request;
  to: string;
  customerName: string;
  tenantName: string;
  username: string;
  rawToken: string;
  expiresAt: Date;
};

type PasswordEmailArgs = {
  req?: Request;
  to: string;
  fullName: string;
  rawToken: string;
  expiresAt: Date;
  purpose: PasswordTokenPurpose;
};

function formatDeadline(value: Date): string {
  return value.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildActionUrl(req: Request | undefined, path: string, rawToken: string) {
  const siteUrl = resolveSiteUrl(req);
  return `${siteUrl}${path}/${encodeURIComponent(rawToken)}`;
}

export async function sendTenantPasswordSetupEmail(args: SetupEmailArgs) {
  const url = buildActionUrl(args.req, "/create-password", args.rawToken);
  const expiryText = formatDeadline(args.expiresAt);
  const subject = `Welcome to Platr - set your EpicPoetry password`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f7f7f5;padding:32px;color:#1f2937">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid #ece7de">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#e8722c;font-weight:700;margin-bottom:8px">Welcome to Platr</div>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#111827">Set up your EpicPoetry account</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7">Hi ${escapeHtml(args.customerName)}, your tenant workspace for <strong>${escapeHtml(args.tenantName)}</strong> is ready.</p>
        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:16px;padding:18px 20px;margin:20px 0">
          <div style="font-size:13px;color:#9a3412;margin-bottom:6px;font-weight:700">Account details</div>
          <div style="font-size:14px;line-height:1.8">
            <div><strong>Tenant / company:</strong> ${escapeHtml(args.tenantName)}</div>
            <div><strong>Login email:</strong> ${escapeHtml(args.username)}</div>
          </div>
        </div>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7">To activate login access, create your password using the secure link below. This link expires on <strong>${escapeHtml(expiryText)}</strong>.</p>
        <div style="margin:28px 0">
          <a href="${url}" style="display:inline-block;background:#e8722c;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">Create your password</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280">If the button does not open, copy and paste this link into your browser:</p>
        <p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${url}" style="color:#b45309">${url}</a></p>
        <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280">If you did not expect this email, you can ignore it. For help, reply to this email or contact your Platr support team.</p>
      </div>
    </div>
  `;
  const text = [
    `Hi ${args.customerName},`,
    ``,
    `Your EpicPoetry workspace for ${args.tenantName} is ready.`,
    `Login email: ${args.username}`,
    ``,
    `Create your password here: ${url}`,
    `This link expires on ${expiryText}.`,
  ].join("\n");
  return sendMail({ to: [args.to], subject, html, text, preferPublicConfig: true });
}

export async function sendPasswordActionEmail(args: PasswordEmailArgs) {
  const route = args.purpose === "password_change" ? "/change-password" : "/reset-password";
  const actionUrl = buildActionUrl(args.req, route, args.rawToken);
  const expiryText = formatDeadline(args.expiresAt);
  const title = args.purpose === "password_change" ? "Confirm your password change" : "Reset your EpicPoetry password";
  const bodyCopy = args.purpose === "password_change"
    ? "We received a request to change your EpicPoetry password. Confirm it using the secure link below."
    : "We received a request to reset your EpicPoetry password. Set a new password using the secure link below.";
  const buttonLabel = args.purpose === "password_change" ? "Confirm password change" : "Reset password";

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f7f7f5;padding:32px;color:#1f2937">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid #ece7de">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#e8722c;font-weight:700;margin-bottom:8px">EpicPoetry Security</div>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#111827">${title}</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7">Hi ${escapeHtml(args.fullName)}, ${bodyCopy}</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7">This link expires on <strong>${escapeHtml(expiryText)}</strong> and can only be used once.</p>
        <div style="margin:28px 0">
          <a href="${actionUrl}" style="display:inline-block;background:#e8722c;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${buttonLabel}</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280">If the button does not open, copy and paste this link into your browser:</p>
        <p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${actionUrl}" style="color:#b45309">${actionUrl}</a></p>
        <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280">If you did not request this, you can safely ignore the email and your current password will stay unchanged.</p>
      </div>
    </div>
  `;
  const text = [
    `Hi ${args.fullName},`,
    ``,
    bodyCopy,
    `${buttonLabel}: ${actionUrl}`,
    `This link expires on ${expiryText}.`,
  ].join("\n");
  return sendMail({ to: [args.to], subject: title, html, text, preferPublicConfig: true });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
