export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function driveConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw Object.assign(new Error("Google Drive integration is not configured."), { statusCode: 503 });
  }
  return { clientId, clientSecret, redirectUri };
}
