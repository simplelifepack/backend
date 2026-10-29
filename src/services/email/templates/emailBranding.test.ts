import assert from "node:assert/strict";
import { renderAccountChangeOtpEmail } from "./accountChangeOtpEmail";
import { renderLoginAlertEmail } from "./loginAlertEmail";
import { renderPasswordResetEmail, renderPasswordResetOtpEmail } from "./passwordResetEmail";
import { renderSignupOtpEmail } from "./signupOtpEmail";
import { renderTrustInvitationEmail } from "./trustInvitationEmail";
import { renderWaitlistConfirmationEmail } from "./waitlistConfirmationEmail";
import { renderWealthHandoffEmail } from "./wealthHandoffEmail";
import { renderWelcomeEmail } from "./welcomeEmail";

const appUrl = "https://readines.com";
const messages = [
  renderSignupOtpEmail({ otp: "123456" }),
  renderWelcomeEmail({ name: "Asha", appUrl }),
  renderLoginAlertEmail({ appUrl, loginTime: "29 October 2026", deviceSummary: "Chrome", locationSummary: "India" }),
  renderPasswordResetEmail({ resetUrl: `${appUrl}/reset-password?token=sample&source=email` }),
  renderPasswordResetOtpEmail({ otp: "234567" }),
  ...(["email", "password", "pin"] as const).map(purpose => renderAccountChangeOtpEmail({ purpose, otp: "345678" })),
  renderTrustInvitationEmail({ ownerName: "Asha", memberName: "Ravi", relation: "Family", accessType: "Emergency", invitationUrl: `${appUrl}/trust/invite?token=sample` }),
  renderWaitlistConfirmationEmail({ unsubscribeUrl: `${appUrl}/unsubscribe?token=sample` }),
  renderWealthHandoffEmail({ recipientName: "Ravi", ownerName: null, handoffLabel: "Family", summary: "Shared records\n<script>private</script>" }),
];

for (const message of messages) {
  assert.match(message.subject, /Readines/, message.subject);
  assert.match(message.text, /Readines/, message.subject);
  assert.match(message.html, /<html lang="en">/, message.subject);
  assert.match(message.html, /https:\/\/readines.com\/readiness-logo.png/, message.subject);
  assert.doesNotMatch(message.subject + message.text + message.html.replace(/readiness-logo\.png/g, "brand-logo.png"), /Readiness|LifePack|>LP<|#(?:F3EBDA|FAF3E7|D8B25A|F0E4C6|A87C22)/i, message.subject);
  assert.doesNotMatch(message.html, /<script>/i, "dynamic content remains escaped");
}
assert.match(messages[0].html, /123456/);
assert.match(messages[3].html, /token=sample&amp;source=email/);
assert.match(messages[messages.length - 1].html, /&lt;script&gt;private&lt;\/script&gt;/);
console.log(`Email branding tests passed (${messages.length} variants).`);
