import { EMAIL_STYLE, escapeHtml, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export function renderWaitlistConfirmationEmail(input: { unsubscribeUrl: string }): EmailRenderResult {
  const subject = "You’re registered for Readines early access";
  const text = [
    "You’re on the early access list",
    "",
    "Thanks for registering for Readines early access.",
    "We’ll let you know when access is available.",
    "",
    "No further action is needed. We’re glad you’re here.",
    "",
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  const html = renderShell(`
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:30px;line-height:1.16;font-weight:700;color:${EMAIL_STYLE.ink};padding:0 0 12px 0;">You’re on the early access list</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0 0 20px 0;">Thanks for registering for Readines early access.</td>
    </tr>
    <tr>
      <td style="border:1px solid ${EMAIL_STYLE.border};border-radius:16px;background:${EMAIL_STYLE.panelSoft};padding:18px;font-size:15px;line-height:1.7;color:${EMAIL_STYLE.ink};">We’ll let you know when access is available.</td>
    </tr>
    <tr>
      <td style="font-size:14px;line-height:1.7;color:${EMAIL_STYLE.body};padding:22px 0 0 0;">No further action is needed. We’re glad you’re here.</td>
    </tr>
    <tr>
      <td style="padding-top:24px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_STYLE.muted};">Early access - Readines</td>
    </tr>
    <tr>
      <td style="font-size:12px;line-height:1.7;color:${EMAIL_STYLE.muted};padding:12px 0 0 0;">You received this email because you registered for early access. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${EMAIL_STYLE.body};text-decoration:underline;">Unsubscribe</a></td>
    </tr>`);

  return { subject, html, text };
}
