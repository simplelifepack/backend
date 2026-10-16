// Return only public project references and provider names. Never return URLs,
// usernames, credentials, bucket names, query parameters or object locators.
function projectReference(url: URL) {
  const direct = url.hostname.match(/^([a-z0-9]{20})(?:\.storage)?\.supabase\.co$/)?.[1]
    ?? url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (direct) return direct;
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    const match = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{20})$/);
    if (match) return match[1];
  }
  return null;
}
export function productionTargetSummary(env: NodeJS.ProcessEnv) {
  const database = new URL(env.DATABASE_URL || "");
  const direct = new URL(env.DIRECT_URL || "");
  const endpoint = new URL(env.STORAGE_ENDPOINT || "");
  const databaseProjectRef = projectReference(database);
  const directProjectRef = projectReference(direct);
  if (databaseProjectRef && directProjectRef && databaseProjectRef !== directProjectRef) throw new Error("PRODUCTION_DATABASE_TARGET_MISMATCH");
  let storageProvider = "s3-compatible";
  if (endpoint.hostname.endsWith(".supabase.co")) storageProvider = "supabase-storage";
  else if (endpoint.hostname.endsWith(".r2.cloudflarestorage.com")) storageProvider = "cloudflare-r2";
  else if (endpoint.hostname === "s3.amazonaws.com" || /\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(endpoint.hostname) || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(endpoint.hostname)) storageProvider = "aws-s3";
  else if (endpoint.hostname.endsWith(".digitaloceanspaces.com")) storageProvider = "digitalocean-spaces";
  return { databaseProvider: "supabase", databaseProjectRef, directProjectRef, storageDriver: "s3", storageProvider, storageProjectRef: storageProvider === "supabase-storage" ? projectReference(endpoint) : null, remoteConnectivityVerified: false };
}
