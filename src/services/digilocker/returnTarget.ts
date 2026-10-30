export const MOBILE_DIGILOCKER_RETURN = "readiness://digilocker";

export function digiLockerReturnTarget(requested?: string): string {
  const web = new URL("/documents", process.env.FRONTEND_URL ?? "http://localhost:5173").toString();
  if (requested === undefined || requested === web) return web;
  if (requested === MOBILE_DIGILOCKER_RETURN) return MOBILE_DIGILOCKER_RETURN;
  throw Object.assign(new Error("Unsupported DigiLocker return URL."), { statusCode: 400, code: "DIGILOCKER_INVALID_REQUEST" });
}

export function digiLockerReturnUrl(result: { id: string; status: string; redirectUrl: string; returnFormat?: "session-v1" }): string {
  // Revalidate persisted targets too. Only the state-bound session chooses a target.
  const target = new URL(digiLockerReturnTarget(result.redirectUrl));
  const params = new URLSearchParams({ digilocker: result.id, result: result.status });
  if (target.protocol === "readiness:" && result.returnFormat === "session-v1") {
    const errors: Record<string, string> = { CONSENT_DENIED: "consent_denied", EXPIRED: "session_expired", CANCELLED: "cancelled" };
    target.search = new URLSearchParams(result.status === "AUTHENTICATED"
      ? { session: result.id } : { error: errors[result.status] ?? "authorization_failed" }).toString();
  }
  else if (target.protocol === "readiness:") target.search = params.toString();
  else target.hash = params.toString();
  return target.toString();
}
