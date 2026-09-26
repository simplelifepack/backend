import type { NextFunction, Request, Response } from "express";

import { getUserById } from "../services/auth.service";
import { verifyAccessToken } from "../utils/jwt";

export type AuthenticatedRequest = Request & {
  authUser: {
    id: string;
    name: string;
    email: string;
  };
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }

    const token = authHeader.slice("Bearer ".length).trim();

  try {
    const payload = verifyAccessToken(token);
    const user = await getUserById(payload.sub);

    if (!user || (payload.authVersion ?? 0) !== (user.authVersion ?? 0)) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    (req as AuthenticatedRequest).authUser = user;
    return next();
  } catch {
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }
}
