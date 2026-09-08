import { normalizeSearchText } from "./normalization";
import { packageSearchMetadata } from "./searchMetadata";

export type ScoredPackFields = { slug: string; title: string; aliases: string[]; category: string; description: string; keywords: string[]; searchMetadata?: unknown };
export type PackMatchReason = "exact_name" | "alias" | "keyword_similarity";
export type PackScore = { matchedTokens: string[]; missingTokens: string[]; packageCoverage: number; score: number; reason: PackMatchReason | null };
const filler = new Set(["a", "again", "am", "an", "are", "do", "for", "from", "get", "getting", "how", "i", "in", "is", "me", "my", "need", "new", "of", "on", "please", "the", "to", "want", "what", "with"]);
const noise = new Set(["application", "checklist", "document", "documents", "pack", "package", "required", "requirement", "requirements"]);

export function normalizePackageQuery(input: string) { const normalized = normalize(input); const allTokens = tokenize(normalized, false); const coreTokens = tokenize(normalized, true); return { normalized, allTokens, coreTokens: coreTokens.length ? coreTokens : allTokens, coreText: (coreTokens.length ? coreTokens : allTokens).join(" ") }; }
export function isBroadPackageQuery(input: string) { return normalizePackageQuery(input).coreTokens.length <= 1; }
export function scorePack(pack: ScoredPackFields, query: string) { return scorePackDetailed(pack, query).score; }
export function scorePackDetailed(pack: ScoredPackFields, query: string): PackScore {
  const parsed = normalizePackageQuery(query); if (!parsed.coreTokens.length) return empty();
  const metadata = packageSearchMetadata(pack.searchMetadata, pack); const querySet = new Set(parsed.coreTokens);
  const title = normalize(pack.title); const slug = normalize(pack.slug); const aliases = pack.aliases.map(normalize);
  if (parsed.normalized === title || parsed.normalized === slug) return result(parsed.coreTokens, [], 1, 120, "exact_name");
  if (aliases.includes(parsed.normalized)) return result(parsed.coreTokens, [], 1, 116, "alias");
  if (!constraintAllows(metadata.jurisdiction, querySet) || !constraintAllows(metadata.destination, querySet)) return empty();

  const candidates = [
    { text: title, weight: 108, reason: "exact_name" as const }, { text: slug, weight: 106, reason: "exact_name" as const },
    ...aliases.map((text) => ({ text, weight: 104, reason: "alias" as const })),
    ...metadata.searchPhrases.map((text) => ({ text, weight: 108, reason: "alias" as const })),
    { text: pack.description, weight: 78, reason: "keyword_similarity" as const, supporting: true },
    ...[metadata.intent, metadata.subject, metadata.purpose, metadata.destination, metadata.jurisdiction].flatMap((text) => text ? [{ text, weight: 82, reason: "keyword_similarity" as const }] : []),
  ];
  let best = empty();
  for (const candidate of candidates) {
    const candidateTokens = tokenize(candidate.text, true); if (!candidateTokens.length) continue;
    const matched = candidateTokens.filter((token) => querySet.has(token)); const missing = candidateTokens.filter((token) => !querySet.has(token));
    const packageCoverage = matched.length / candidateTokens.length; const queryCoverage = matched.length / parsed.coreTokens.length;
    let score = 0;
    if ("supporting" in candidate && candidate.supporting && matched.length >= 2 && queryCoverage >= 0.5) score = Math.round(60 + 30 * queryCoverage);
    if (parsed.coreTokens.length === 1 && matched.length === 1) score = 76;
    if (packageCoverage === 1 && (candidateTokens.length > 1 || parsed.coreTokens.length === 1)) score = candidate.weight + Math.min(candidateTokens.length, 6);
    else if (matched.length >= 2 && packageCoverage >= 0.6 && queryCoverage >= 0.5) score = Math.round(candidate.weight * (0.45 * packageCoverage + 0.55 * queryCoverage));
    if ((metadata.jurisdiction || metadata.destination) && score >= 70) score += 8;
    if (score > best.score) best = result(matched, missing, packageCoverage, score, candidate.reason);
  }
  return best.score >= 70 ? best : empty();
}
function constraintAllows(value: string | undefined, query: Set<string>) { if (!value) return true; const tokens = tokenize(value, true); return tokens.length === 0 || tokens.every((token) => query.has(token)); }
function normalize(value: string) { return normalizeSearchText(value).replace(/\b([a-z]{4,})ies\b/g, "$1y").replace(/\b([a-z]{4,})s\b/g, "$1"); }
function tokenize(value: string, strip: boolean) { return [...new Set(normalize(value).split(" ").filter((token) => token && (!strip || (!filler.has(token) && !noise.has(token)))) )]; }
function result(matchedTokens: string[], missingTokens: string[], packageCoverage: number, score: number, reason: PackMatchReason): PackScore { return { matchedTokens, missingTokens, packageCoverage, score, reason }; }
function empty(): PackScore { return { matchedTokens: [], missingTokens: [], packageCoverage: 0, score: 0, reason: null }; }
