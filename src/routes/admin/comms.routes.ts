import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth } from "../../middleware/adminAuth";
import { requireCapability } from "../../middleware/adminRbac";
import { renderLoginAlertEmail } from "../../services/email/templates/loginAlertEmail";
import { renderPasswordResetEmail, renderPasswordResetOtpEmail } from "../../services/email/templates/passwordResetEmail";
import { renderWelcomeEmail } from "../../services/email/templates/welcomeEmail";
import { renderTrustInvitationEmail } from "../../services/email/templates/trustInvitationEmail";
import { renderWealthHandoffEmail } from "../../services/email/templates/wealthHandoffEmail";
import { renderSignupOtpEmail } from "../../services/email/templates/signupOtpEmail";
import { renderAccountChangeOtpEmail } from "../../services/email/templates/accountChangeOtpEmail";

const router = Router();
// Read-only (log viewing + template preview with sample data, never a real
// user's data) — broadly available like users.view, no step-up needed since
// nothing here mutates anything.
router.use(requireAdminAuth, requireCapability("users.view"));

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).catch(50),
  template: z.string().trim().min(1).optional(),
  status: z.enum(["sent", "failed"]).optional(),
});

router.get("/email-log", async (req, res, next) => {
  try {
    const { limit, template, status } = listSchema.parse(req.query);
    const where = { ...(template ? { template } : {}), ...(status ? { status } : {}) };
    const [total, sentCount, failedCount, items] = await Promise.all([
      prisma.emailLog.count({ where }),
      prisma.emailLog.count({ where: { ...where, status: "sent" } }),
      prisma.emailLog.count({ where: { ...where, status: "failed" } }),
      prisma.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    ]);
    return res.json({ total, sentCount, failedCount, items });
  } catch (error) {
    return next(error);
  }
});

// Sample data only — never a real user's name/email/content. Each entry
// mirrors one of emailService.ts's SendType values (plus "raw", which has
// no fixed template to preview since the caller builds it inline).
const SAMPLE_RENDERERS: Record<string, () => { subject: string; html: string; text: string }> = {
  welcome: () => renderWelcomeEmail({ name: "Sample User", appUrl: "https://app.example.com" }),
  login_alert: () => renderLoginAlertEmail({
    appUrl: "https://app.example.com", loginTime: "12 Oct 2026, 3:45 PM",
    deviceSummary: "Chrome on macOS", locationSummary: "203.0.113.x",
  }),
  password_reset: () => renderPasswordResetEmail({ resetUrl: "https://app.example.com/reset/sample-token" }),
  password_reset_otp: () => renderPasswordResetOtpEmail({ otp: "123456" }),
  signup_otp: () => renderSignupOtpEmail({ otp: "654321" }),
  account_change: () => renderAccountChangeOtpEmail({ otp: "111222", purpose: "email" }),
  trust_invitation: () => renderTrustInvitationEmail({
    ownerName: "Sample Owner", memberName: "Sample Member", relation: "Spouse",
    accessType: "FAMILY_MEMBER", invitationUrl: "https://app.example.com/invite/sample-token",
  }),
  wealth_handoff: () => renderWealthHandoffEmail({
    recipientName: "Sample Recipient", ownerName: "Sample Owner",
    handoffLabel: "Emergency", summary: "A sample handoff summary for preview purposes.",
  }),
};

router.get("/templates", async (_req, res) => {
  return res.json({ templates: Object.keys(SAMPLE_RENDERERS) });
});

router.get("/templates/:name/preview", async (req, res) => {
  const name = z.string().min(1).parse(req.params.name);
  const renderer = SAMPLE_RENDERERS[name];
  if (!renderer) return res.status(404).json({ message: "Unknown template. No sample renderer registered for it." });
  return res.json(renderer());
});

export default router;
