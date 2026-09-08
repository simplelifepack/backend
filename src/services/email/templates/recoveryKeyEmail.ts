import { EMAIL_STYLE, escapeHtml, renderShell, type EmailRenderResult } from "./emailTemplateHelpers";

export function renderRecoveryKeyEmail(input: { recoveryDocument: string }): EmailRenderResult {
  const content = `
    <tr>
      <td>
        <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.25;color:${EMAIL_STYLE.ink};font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;">Readiness recovery key</h1>
        <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:${EMAIL_STYLE.body};">Keep this email somewhere private. Anyone with this recovery key and your email can recover your account.</p>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:16px;border-radius:12px;background:${EMAIL_STYLE.panel};border:1px solid ${EMAIL_STYLE.borderDeep};font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${EMAIL_STYLE.ink};">${escapeHtml(input.recoveryDocument)}</pre>
      </td>
    </tr>`;

  return {
    subject: "Your Readiness recovery key",
    html: renderShell(content),
    text: input.recoveryDocument,
  };
}
