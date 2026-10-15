import { prisma } from "../lib/prisma";

export type SignInMethod = "password" | "pin" | "google" | "signup";

/** The single choke point for writing a `SignInEvent` row — same pattern as
 * `sendAndLog` for `EmailLog` in Phase 3. Called from every customer
 * sign-in path (`auth.service.ts`): password login, PIN login, Google
 * login, and signup (a new account's first session). Awaited, not
 * fire-and-forget like `dispatchAuthEmail` — a security/access log that can
 * silently fail to write undermines the retention floor it exists to prove
 * — but a write failure here must never fail the sign-in itself, so it's
 * caught and logged, not rethrown. */
export async function recordSignIn(userId: string, method: SignInMethod, context?: { ip?: string; userAgent?: string }) {
  try {
    await prisma.signInEvent.create({
      data: { userId, method, ip: context?.ip, userAgent: context?.userAgent },
    });
  } catch (error) {
    console.error({
      event: "sign_in_event_record_failed",
      method,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
}
