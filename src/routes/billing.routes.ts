import express, { Router } from "express";
import { z } from "zod";
import { billingService } from "../services/billing/runtime";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { BillingService } from "../services/billing/service";
import { BillingError, publicCatalogue } from "../services/billing/catalogue";

export function billingRouter(service = billingService) {
  const router = Router();
  const handle = (work: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try { res.setHeader("Cache-Control", "no-store"); return res.json(await work(req)); }
    catch (error) {
      if (error instanceof BillingError) return res.status(error.statusCode).json({ code: error.code, message: error.message });
      if (error instanceof z.ZodError || error instanceof SyntaxError) return res.status(400).json({ message: "Invalid billing request." });
      return next(error);
    }
  };
  const id = (req: express.Request) => (req as AuthenticatedRequest).authUser.id;
  router.post("/webhook", express.raw({ type: "application/json", limit: "256kb" }), handle(req => {
    if (!Buffer.isBuffer(req.body)) throw new BillingError("BILLING_WEBHOOK_INVALID", "Raw JSON is required.");
    return service.webhook(req.body, req.get("x-razorpay-signature") ?? "", req.get("x-razorpay-event-id") ?? "");
  }));
  router.get("/plans", handle(async () => publicCatalogue()));
  router.use(requireAuth);
  router.get("/subscription", handle(req => service.status(id(req))));
  router.post("/checkout", express.json({ limit: "4kb" }), handle(req => service.checkout(id(req), z.object({ plan: z.enum(["monthly", "annual"]) }).strict().parse(req.body).plan)));
  router.post("/verify", express.json({ limit: "4kb" }), handle(req => service.verify(id(req), z.object({ razorpay_payment_id: z.string().regex(/^pay_[a-zA-Z0-9]+$/), razorpay_subscription_id: z.string().regex(/^sub_[a-zA-Z0-9]+$/), razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict().parse(req.body))));
  router.post("/cancel", handle(req => service.cancel(id(req))));
  return router;
}
export default billingRouter();
