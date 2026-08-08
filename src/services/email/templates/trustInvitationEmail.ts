import {
  EMAIL_STYLE,
  appAccessBlock,
  cleanDisplayName,
  escapeHtml,
  renderShell,
  type EmailRenderResult,
} from "./emailTemplateHelpers";

export type TrustInvitationEmailInput = {
  ownerName: string | null;
  memberName: string;
  relation: string;
  accessType: string;
  invitationUrl: string;
};

export function renderTrustInvitationEmail(input: TrustInvitationEmailInput): EmailRenderResult {
  const owner = cleanDisplayName(input.ownerName);
  const relation = escapeHtml(input.relation);
  const accessType = escapeHtml(input.accessType);
  const content = `
    <tr>
      <td>
        <h1 style="margin:0 0 14px 0;font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:26px;line-height:1.2;color:${EMAIL_STYLE.ink};">You've been invited to LifePack</h1>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:${EMAIL_STYLE.body};">${escapeHtml(owner)} invited you to become a trusted member in LifePack.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid ${EMAIL_STYLE.borderDeep};border-radius:16px;background:#FFFFFF;">
          <tr>
            <td style="padding:16px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:${EMAIL_STYLE.body};">
              <strong style="color:${EMAIL_STYLE.ink};">Relationship:</strong> ${relation}<br>
              <strong style="color:${EMAIL_STYLE.ink};">Access:</strong> ${accessType}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:14px;line-height:1.7;color:${EMAIL_STYLE.body};">Review and respond to your invitation below.</p>
        ${appAccessBlock("Review Invitation", input.invitationUrl)}
        <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:${EMAIL_STYLE.muted};">This invitation expires in 24 hours. For your security, your inviter will provide you with a separate 6-digit PIN.</p>
        <p style="margin:10px 0 0 0;font-size:12px;line-height:1.6;color:${EMAIL_STYLE.muted};">This email contains no private document information.</p>
      </td>
    </tr>`;

  return {
    subject: "You've been invited to LifePack",
    html: renderShell(content),
    text: [
      `${owner} invited you to become a trusted member in LifePack.`,
      `Relationship: ${input.relation}`,
      `Access: ${input.accessType}`,
      `Review Invitation: ${input.invitationUrl}`,
      "This invitation expires in 24 hours.",
      "For your security, your inviter will provide you with a separate 6-digit PIN.",
      "This email contains no private document information.",
    ].join("\n\n"),
  };
}
