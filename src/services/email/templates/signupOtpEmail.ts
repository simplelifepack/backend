import { EMAIL_STYLE, escapeHtml, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export function renderSignupOtpEmail({ otp }: { otp: string }): EmailRenderResult {
  const safeOtp = escapeHtml(otp);
  const html = renderShell(`
    <tr>
      <td style="font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:30px;line-height:1.16;font-weight:700;color:${EMAIL_STYLE.ink};padding:0 0 12px 0;">Verify your email</td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0 0 16px 0;">Use this 6-digit code to finish creating your Readiness account.</td>
    </tr>
    <tr>
      <td style="padding:8px 0 20px 0;">
        <div style="display:inline-block;border:1px solid ${EMAIL_STYLE.borderDeep};border-radius:16px;background:#FFFFFF;padding:16px 22px;font-family:'JetBrains Mono','Courier New',monospace;font-size:30px;line-height:1;font-weight:700;letter-spacing:8px;color:${EMAIL_STYLE.ink};">${safeOtp}</div>
      </td>
    </tr>
    <tr>
      <td style="font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};padding:0;">This code expires in 30 minutes. If you did not request this, you can ignore this email.</td>
    </tr>
    <tr>
      <td style="padding-top:22px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_STYLE.muted};">Signup code - Readiness</td>
    </tr>`);

  return {
    subject: "Your Readiness signup code",
    html,
    text: `Your Readiness signup code is ${otp}.\n\nThis code expires in 30 minutes. If you did not request this, you can ignore this email.`,
  };
}
