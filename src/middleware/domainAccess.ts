export const productionOrigins = ["https://readines.com", "https://www.readines.com"];
export function allowedBrowserOrigins() {
  return new Set([
    ...productionOrigins,
    "https://frontend-web-nine-amber.vercel.app",
    "http://localhost:5173",
    ...["CORS_ORIGINS", "CORS_LOCALHOST_ORIGINS", "CORS_PREVIEW_ORIGINS"].flatMap(name => (process.env[name] ?? "").split(",").map(value => value.trim()).filter(Boolean)),
  ]);
}
