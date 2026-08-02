import { z } from "zod";

import { frontendUrl } from "./config";
import {
  completeAuthorization,
  consumeOAuthState,
  GmailOAuthError,
  type GmailOAuthErrorCode,
} from "./oauth";

export type CallbackReason = GmailOAuthErrorCode | "invalid_request" | "access_denied" | "authorization_failed";
type CallbackResult = { redirectUrl: string; success: boolean };

export function callbackRedirect(status: "connected" | "error", reason?: CallbackReason) {
  const url = new URL("/google-gmail-callback.html", frontendUrl());
  url.searchParams.set("gmail", status);
  if (status === "error" && reason) url.searchParams.set("reason", reason);
  return url.toString();
}

export async function handleGmailCallback(
  query: unknown,
  authorize: (code: string, state: string) => Promise<unknown> = completeAuthorization,
  consumeState: (state: string) => Promise<unknown> = consumeOAuthState,
): Promise<CallbackResult> {
  const parsed = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1),
    error: z.string().min(1).optional(),
  }).safeParse(query);
  if (!parsed.success || (!parsed.data.code && !parsed.data.error)) {
    return { success: false, redirectUrl: callbackRedirect("error", "invalid_request") };
  }
  if (parsed.data.error) {
    try { await consumeState(parsed.data.state); }
    catch { return { success: false, redirectUrl: callbackRedirect("error", "invalid_state") }; }
    return { success: false, redirectUrl: callbackRedirect("error", "access_denied") };
  }
  try {
    await authorize(parsed.data.code!, parsed.data.state);
    return { success: true, redirectUrl: callbackRedirect("connected") };
  } catch (error) {
    const reason = error instanceof GmailOAuthError ? error.safeCode : "authorization_failed";
    return { success: false, redirectUrl: callbackRedirect("error", reason) };
  }
}
