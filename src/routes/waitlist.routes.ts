import { waitUntil } from "@vercel/functions";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ipKeyGenerator } from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { allowWaitlistRequest, createChallenge, verifyChallenge, verifyUnsubscribe } from "../services/waitlistSecurity";
import { registerWaitlistEmail, registrationMessage } from "../services/waitlist";

const router = Router();
const wrap = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const limit: RequestHandler = wrap(async (req, res, next) => {
  if (!process.env.WAITLIST_SECRET || process.env.WAITLIST_SECRET.length < 32) return res.status(503).json({ message: "Registration is temporarily unavailable." });
  if (!await allowWaitlistRequest("ip", ipKeyGenerator(req.ip ?? "unknown"), 60)) {
    res.set("Retry-After", "3600");
    return res.status(429).json({ message: "Too many attempts. Please try again later." });
  }
  next();
});
router.use(limit);
router.get("/challenge", wrap(async (req, res) => {
  res.json(createChallenge(req.ip ?? "unknown"));
}));
const registration = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  website: z.string().max(500).optional().default(""),
  challenge: z.string().max(300),
  solution: z.string().max(7),
}).strict();
router.post("/register", wrap(async (req, res) => {
  const parsed = registration.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Enter a valid email and complete registration again." });
  const { email, website, challenge, solution } = parsed.data;
  if (website) return res.json({ message: registrationMessage });
  const proof = verifyChallenge(challenge, solution, req.ip ?? "unknown");
  if (!proof) return res.status(400).json({ message: "Registration expired. Please try again." });
  if (!await allowWaitlistRequest("email", email, 5)) {
    res.set("Retry-After", "3600");
    return res.status(429).json({ message: "Too many attempts. Please try again later." });
  }
  const claim = await prisma.waitlistProof.createMany({ data: [proof], skipDuplicates: true });
  if (!claim.count) return res.status(400).json({ message: "Registration expired. Please try again." });
  res.json(await registerWaitlistEmail(email, waitUntil));
}));
router.post("/unsubscribe", wrap(async (req, res) => {
  const token = z.string().max(200).safeParse(req.body?.token);
  const id = token.success ? verifyUnsubscribe(token.data) : null;
  if (!id) return res.status(400).json({ message: "Invalid unsubscribe link." });
  await prisma.waitlistRegistration.updateMany({ where: { id, status: "registered" }, data: { status: "unsubscribed", unsubscribedAt: new Date() } });
  res.json({ message: "You’ve been unsubscribed from early access emails." });
}));
export default router;
