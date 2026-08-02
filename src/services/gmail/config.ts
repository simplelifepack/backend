export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function gmailConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error("Gmail integration is not configured.");
    Object.assign(error, { statusCode: 503 });
    throw error;
  }
  return { clientId, clientSecret, redirectUri };
}

export function frontendUrl() {
  return (process.env.FRONTEND_URL ?? process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
}
