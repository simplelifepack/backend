import { appAccessBlock, cleanDisplayName, EMAIL_STYLE, escapeHtml, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export type WelcomeEmailInput = {
  name?: string | null;
  appUrl: string;
};

export function renderWelcomeEmail(input: WelcomeEmailInput): EmailRenderResult {
  const name = escapeHtml(cleanDisplayName(input.name));
  const subject = "Welcome to Readiness";
  const text = [
    `Welcome, ${cleanDisplayName(input.name)}`,
    "",
    "Your Readiness is ready.",
    "",
    "Keep important documents organized, understand what is ready, and prepare for major life events without searching everywhere.",
    "",
    `Open Readiness: ${input.appUrl}`,
    "",
    "Security note: Readiness will never ask for your password by email.",
    "",
    "This message was sent by Readiness.",
  ].join("\n");

  const html = renderShell(`
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:30px;line-height:1.16;font-weight:700;color:${EMAIL_STYLE.ink};padding:0 0 12px 0;">Welcome, ${name}</td>
    </tr>
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;font-weight:700;color:${EMAIL_STYLE.clay};padding:0 0 14px 0;">Your Readiness is ready.</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0;">Keep important documents organized, understand what is ready, and prepare for major life events without searching everywhere.</td>
    </tr>
    <tr>
      <td>${appAccessBlock("Open Readiness", input.appUrl)}</td>
    </tr>
    <tr>
      <td style="border:1px solid ${EMAIL_STYLE.borderDeep};border-radius:16px;background:rgba(255,255,255,.72);padding:16px 18px;font-size:14px;line-height:1.65;color:${EMAIL_STYLE.body};">Private by design. Readiness will never ask for your password by email.</td>
    </tr>
    <tr>
      <td style="padding-top:24px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_STYLE.muted};">Account message - Readiness</td>
    </tr>`);

  return { subject, html, text };
}
