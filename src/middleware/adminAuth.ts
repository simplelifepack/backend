import type { NextFunction, Request, Response } from "express";
import type { AdminRole } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { isAdminTokenPayload, verifyAdminToken } from "../utils/adminJwt";
import type { AdminCapability } from "./adminRbac";

export type AdminAuthenticatedRequest = Request & {
  adminUser: { id: string; email: string; name: string; role: AdminRole };
  adminSession: { id: string; stepUpAt: Date | null };
  grant?: "yes" | "step_up" | "approval" | "view" | "own" | "none";
};

/** Decision D2: separate secret + audience, so a customer (`User`) token can
 * never satisfy this check — `verifyAdminToken` enforces `aud: "admin"` on the
 * JWT itself, not just a shared-secret coincidence. */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized." });
  }
  try {
    const payload = verifyAdminToken(authHeader.slice("Bearer ".length).trim());
    if (!isAdminTokenPayload(payload)) return res.status(401).json({ message: "Unauthorized." });

    const [admin, session] = await Promise.all([
      prisma.adminUser.findUnique({ where: { id: payload.sub } }),
      prisma.adminSession.findUnique({ where: { id: payload.sessionId } }),
    ]);

    if (!admin || admin.disabledAt || !session || session.revokedAt) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (payload.authVersion !== admin.authVersion) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    (req as AdminAuthenticatedRequest).adminUser = {
      id: admin.id, email: admin.email, name: admin.name, role: admin.role,
    };
    (req as AdminAuthenticatedRequest).adminSession = { id: session.id, stepUpAt: session.stepUpAt };
    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized." });
  }
}

export type { AdminCapability };
