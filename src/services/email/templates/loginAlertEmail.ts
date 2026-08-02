import { appAccessBlock, EMAIL_STYLE, escapeHtml, isPublicHttpsUrl, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export type LoginAlertEmailInput = {
  appUrl: string;
  loginTime: string;
  deviceSummary: string;
  locationSummary: string;
};

export function renderLoginAlertEmail(input: LoginAlertEmailInput): EmailRenderResult {
  const subject = "New login to your LifePack account";
  const text = [
    "New login detected",
    "",
    "A new login to your LifePack account was recorded.",
    "",
    `Time: ${input.loginTime}`,
    `Device: ${input.deviceSummary}`,
    `Location/IP: ${input.locationSummary}`,
    "",
    "If this was you, no action is required.",
    "If this was not you, change your password and review active sessions.",
    "",
    isPublicHttpsUrl(input.appUrl) ? `Open LifePack: ${input.appUrl}` : "Open LifePack from the browser where you started this session.",
    "",
    "This security message was sent by LifePack.",
  ].join("\n");

  const rows = [
    ["Time", input.loginTime],
    ["Device", input.deviceSummary],
    ["Location/IP", input.locationSummary],
  ];

  const html = renderShell(`
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:30px;line-height:1.16;font-weight:700;color:${EMAIL_STYLE.ink};padding:0 0 12px 0;">New login detected</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0 0 20px 0;">A new login to your LifePack account was recorded.</td>
    </tr>
    <tr>
      <td style="border:1px solid ${EMAIL_STYLE.gold}33;border-radius:16px;background:${EMAIL_STYLE.goldSoft};padding:4px 18px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          ${rows.map(([label, value]) => `
            <tr>
              <td style="padding:13px 0;border-bottom:1px solid ${EMAIL_STYLE.border};font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${EMAIL_STYLE.muted};width:118px;">${escapeHtml(label)}</td>
              <td style="padding:13px 0;border-bottom:1px solid ${EMAIL_STYLE.border};font-size:14px;line-height:1.45;color:${EMAIL_STYLE.ink};">${escapeHtml(value)}</td>
            </tr>`).join("")}
        </table>
      </td>
    </tr>
    <tr>
      <td style="font-size:14px;line-height:1.7;color:${EMAIL_STYLE.body};padding:22px 0 0 0;">If this was you, no action is required.</td>
    </tr>
    <tr>
      <td style="font-size:14px;line-height:1.7;color:${EMAIL_STYLE.body};padding:6px 0 0 0;">If this was not you, change your password and review active sessions.</td>
    </tr>
    <tr>
      <td>${appAccessBlock("Open LifePack", input.appUrl)}</td>
    </tr>
    <tr>
      <td style="padding-top:2px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_STYLE.muted};">Security notice - LifePack</td>
    </tr>`);

  return { subject, html, text };
}
