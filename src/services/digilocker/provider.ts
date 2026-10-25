import { createHmac, timingSafeEqual } from "node:crypto";
import { loadDigiLockerConfig } from "../../config/digilocker";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "../documentUploadLimits";

export type LockerDocument = {
  reference: string; name: string; type: string; issuer: string | null;
  issueDate: string | null; modifiedAt: string | null; mimeType: string;
  available: boolean; reason: string | null;
};
export const providerError = () => Object.assign(new Error("DigiLocker could not complete the request. Reconnect if access has expired."), { statusCode: 502 });

// Bounded reads, no redirects (including file downloads), and fixed provider host.
export async function providerRequest(endpoint: string, init: RequestInit = {}, maxBytes = 1024 * 1024) {
  try {
    const response = await fetch(`${loadDigiLockerConfig().baseUrl}${endpoint}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      await response.body?.cancel();
      throw providerError();
    }
    const chunks: Buffer[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) throw providerError();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maxBytes) throw providerError();
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    return { content: Buffer.concat(chunks), headers: response.headers };
  } catch { throw providerError(); }
}

export function authorizationUrl(state: string, challenge: string) {
  const config = loadDigiLockerConfig();
  const url = new URL(`${config.baseUrl}/oauth2/1/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId,
    redirect_uri: config.redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return url.toString();
}
export async function exchangeCode(code: string, verifier: string) {
  const config = loadDigiLockerConfig();
  const response = await providerRequest("/oauth2/2/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: verifier }),
  });
  const data = JSON.parse(response.content.toString());
  if (typeof data.access_token !== "string" || data.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) throw providerError();
  const consentRemaining = data.consent_valid_till === undefined ? 1800 : Number(data.consent_valid_till) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(consentRemaining) || consentRemaining <= 0) throw providerError();
  // No refresh token or identity claims are retained.
  return { accessToken: data.access_token as string, expiresIn: Math.min(Number(data.expires_in), consentRemaining, 1800), scope: String(data.scope ?? "") };
}
export function normalizeIssuedDocuments(items: unknown): LockerDocument[] {
  if (!Array.isArray(items)) throw providerError();
  const seen = new Set<string>();
  return items.flatMap(item => {
    if (!item || typeof item.uri !== "string" || !item.uri || item.uri.length > 1024 || seen.has(item.uri)) return [];
    seen.add(item.uri);
    const mime = (Array.isArray(item.mime) ? item.mime : [item.mime]).map((value: unknown) => String(value).toLowerCase());
    const restricted = /aadhaar|adhar|uidai/i.test([item.uri, item.doctype, item.name, item.issuerid].join(" "));
    const available = !restricted && mime.includes("application/pdf");
    return [{ reference: item.uri, name: String(item.name ?? "Issued document").slice(0, 300),
      type: String(item.description ?? item.doctype ?? "Document").slice(0, 300), issuer: typeof item.issuer === "string" ? item.issuer.slice(0, 300) : null,
      issueDate: null, modifiedAt: typeof item.date === "string" ? item.date : null,
      mimeType: "application/pdf", available,
      reason: restricted ? "Aadhaar import requires separately verified permissions and handling." : available ? null : "A downloadable PDF is not available through this API." }];
  });
}
export async function issuedDocuments(accessToken: string) {
  const response = await providerRequest("/oauth2/2/files/issued", { headers: { Authorization: `Bearer ${accessToken}` } });
  return normalizeIssuedDocuments(JSON.parse(response.content.toString()).items);
}
export async function downloadDocument(accessToken: string, reference: string) {
  const response = await providerRequest(`/oauth2/1/file/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" },
  }, MAX_DOCUMENT_UPLOAD_BYTES);
  const expected = createHmac("sha256", loadDigiLockerConfig().clientSecret).update(response.content).digest();
  const actual = Buffer.from(response.headers.get("hmac") ?? "", "base64");
  if (response.headers.get("content-type")?.split(";")[0].toLowerCase() !== "application/pdf" ||
      expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    response.content.fill(0); throw providerError();
  }
  return response.content;
}
export async function revokeToken(token: string) {
  const config = loadDigiLockerConfig();
  await providerRequest("/oauth2/1/revoke", { method: "POST", headers: {
    Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  }, body: new URLSearchParams({ token, token_type_hint: "access_token" }) });
}
