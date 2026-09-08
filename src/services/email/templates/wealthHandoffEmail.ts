function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderWealthHandoffEmail(input: {
  recipientName: string;
  ownerName: string | null;
  handoffLabel: string;
  summary: string;
}) {
  const safeOwner = input.ownerName?.trim() || "A Readiness member";
  const security = "The attached ZIP contains only the intended shared Wealth documents and summary. Readiness never includes passwords, encryption keys, authentication tokens, or connected account credentials.";
  return {
    subject: `Readiness Wealth SOS Handoff from ${safeOwner}`,
    text: [`Hello ${input.recipientName},`, "", `${safeOwner} generated a ${input.handoffLabel} Wealth SOS Handoff package for you.`, "", input.summary, "", security].join("\n"),
    html: `<p>Hello ${escapeHtml(input.recipientName)},</p><p>${escapeHtml(safeOwner)} generated a <strong>${escapeHtml(input.handoffLabel)}</strong> Wealth SOS Handoff package for you.</p><pre style="font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;background:#f5f7fb;padding:12px;border-radius:8px">${escapeHtml(input.summary)}</pre><p>${escapeHtml(security)}</p>`,
  };
}
