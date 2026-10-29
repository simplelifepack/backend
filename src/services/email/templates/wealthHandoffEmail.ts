import { EMAIL_STYLE, escapeHtml, renderShell } from "./emailTemplateHelpers";

export function renderWealthHandoffEmail(input: {
  recipientName: string;
  ownerName: string | null;
  handoffLabel: string;
  summary: string;
}) {
  const safeOwner = input.ownerName?.trim() || "A Readines member";
  const security = "The attached ZIP contains only the intended shared Wealth documents and summary. Readines never includes passwords, encryption keys, authentication tokens, or connected account credentials.";
  return {
    subject: `Readines Wealth SOS Handoff from ${safeOwner}`,
    text: [`Hello ${input.recipientName},`, "", `${safeOwner} generated a ${input.handoffLabel} Wealth SOS Handoff package for you.`, "", input.summary, "", security].join("\n"),
    html: renderShell(`
      <tr><td style="font-size:26px;line-height:1.25;font-weight:700;color:${EMAIL_STYLE.ink};padding-bottom:16px;">Wealth SOS Handoff</td></tr>
      <tr><td style="font-size:15px;line-height:1.7;padding-bottom:16px;">Hello ${escapeHtml(input.recipientName)},</td></tr>
      <tr><td style="font-size:15px;line-height:1.7;padding-bottom:20px;">${escapeHtml(safeOwner)} generated a <strong>${escapeHtml(input.handoffLabel)}</strong> Wealth SOS Handoff package for you.</td></tr>
      <tr><td style="background:${EMAIL_STYLE.panelSoft};border:1px solid ${EMAIL_STYLE.border};border-radius:12px;padding:16px;"><pre style="margin:0;font-family:'Courier New',monospace;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(input.summary)}</pre></td></tr>
      <tr><td style="font-size:13px;line-height:1.7;color:${EMAIL_STYLE.muted};padding-top:20px;">${escapeHtml(security)}</td></tr>`),
  };
}
