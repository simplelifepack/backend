import { completeDriveAuthorization, DriveOAuthError, type DriveOAuthErrorCode } from "./oauth";

type Reason = DriveOAuthErrorCode | "invalid_request" | "access_denied" | "authorization_failed";

function redirect(status: "connected" | "error", reason?: Reason) {
  const url = new URL("/google-drive-callback.html", process.env.FRONTEND_URL?.trim() || "http://localhost:5173");
  url.searchParams.set("drive", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

export async function handleDriveCallback(query: unknown) {
  const values = query as { code?: unknown; state?: unknown; error?: unknown };
  if (values.error === "access_denied") return { redirectUrl: redirect("error", "access_denied") };
  if (typeof values.code !== "string" || typeof values.state !== "string") return { redirectUrl: redirect("error", "invalid_request") };
  try {
    await completeDriveAuthorization(values.code, values.state);
    return { redirectUrl: redirect("connected") };
  } catch (error) {
    return { redirectUrl: redirect("error", error instanceof DriveOAuthError ? error.safeCode : "authorization_failed") };
  }
}
