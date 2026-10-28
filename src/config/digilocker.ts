export function loadDigiLockerConfig() {
  const clientId = process.env.DIGILOCKER_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI?.trim() ?? "";
  const environment = process.env.DIGILOCKER_ENVIRONMENT?.trim() ?? "";
  let validRedirect = false;
  try {
    const url = new URL(redirectUri);
    validRedirect = !url.username && !url.password && !url.hash && !url.search &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { /* Unconfigured until a valid backend callback is supplied. */ }
  return { clientId, clientSecret, redirectUri, environment,
    configured: Boolean(clientId && clientSecret && validRedirect && environment === "production" && (!process.env.VERCEL || process.env.CRON_SECRET)),
    baseUrl: "https://digilocker.meripehchaan.gov.in/public",
  };
}
