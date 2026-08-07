import { ctaButton, EMAIL_STYLE, escapeHtml, isPublicHttpsUrl, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export function renderPasswordResetEmail({ resetUrl }: { resetUrl: string }): EmailRenderResult {
  const publicLink = isPublicHttpsUrl(resetUrl);
  const safeResetUrl = escapeHtml(resetUrl);
  const action = publicLink
    ? ctaButton("Reset password", resetUrl)
    : `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0;width:100%;">
        <tr>
          <td style="border:1px solid ${EMAIL_STYLE.borderDeep};border-radius:14px;background:#FFFFFF;padding:14px 16px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${EMAIL_STYLE.body};word-break:break-word;">
            Copy and paste this reset link into the browser where you started the request:<br>
            <span style="font-family:'JetBrains Mono','Courier New',monospace;font-size:12px;color:${EMAIL_STYLE.ink};">${safeResetUrl}</span>
          </td>
        </tr>
      </table>`;

  const html = renderShell(`
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:30px;line-height:1.16;font-weight:700;color:${EMAIL_STYLE.ink};padding:0 0 12px 0;">Reset your password</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0 0 16px 0;">We received a request to reset the password for your LifePack account.</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0;">This link expires in 30 minutes. If you did not request this, you can ignore this email.</td>
    </tr>
    <tr>
      <td>${action}</td>
    </tr>
    <tr>
      <td style="padding-top:2px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_STYLE.muted};">Security message - LifePack</td>
    </tr>`);

  return {
    subject: "Reset your LifePack password",
    html,
    text: `Reset your LifePack password\n\nUse this link within 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
  };
}
