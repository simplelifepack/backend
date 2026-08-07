import { normalizeSearchText, slugify } from "./normalization";

type ScoredPackFields = {
  slug: string;
  title: string;
  aliases: string[];
  category: string;
  description: string;
  keywords: string[];
};

export type PackMatchReason =
  | "exact_name"
  | "alias"
  | "provider_purpose"
  | "location_purpose"
  | "keyword_similarity";

export type PackScore = {
  matchedTokens: string[];
  missingTokens: string[];
  score: number;
  reason: PackMatchReason | null;
};

const providers = new Set([
  "axis", "bank", "bob", "boi", "canara", "citi", "hdfc", "hsbc", "icici", "idbi",
  "idfc", "indusind", "kotak", "pnb", "sbi", "union", "yes",
]);

const locations = new Set([
  "andhra", "australia", "bangalore", "bengaluru", "canada", "china", "delhi", "gujarat", "hyderabad", "india",
  "karnataka", "kerala", "maharashtra", "mumbai", "pune", "tamil", "telangana",
  "uk", "us", "usa",
]);

const genericIntentTokens = new Set([
  "account", "admission", "application", "certificate", "document", "insurance",
  "licence", "license", "loan", "pack", "package", "passport", "property", "visa",
]);

const purposeAliases: Record<string, string[]> = {
  demat: ["demat", "trading", "brokerage"],
  home_loan: ["home", "housing", "loan"],
  vehicle_loan: ["vehicle", "car", "bike", "auto", "loan", "finance"],
  property_purchase: ["property", "land", "agricultural", "agriculture", "purchase", "buy"],
};

const specificVehicleTerms = new Set(["auto", "bike", "car", "two", "wheeler"]);

function tokens(input: string) {
  return new Set(normalizeSearchText(input).split(" ").filter(Boolean));
}

export function scorePack(pack: ScoredPackFields, query: string) {
  return scorePackDetailed(pack, query).score;
}

export function scorePackDetailed(pack: ScoredPackFields, query: string): PackScore {
  const normalizedQuery = normalizeSearchText(query);
  const querySlug = slugify(query);
  if (!normalizedQuery) return emptyScore();

  const haystacks = [
    { text: normalizeSearchText(pack.slug), weight: 115, reason: "exact_name" as const },
    { text: normalizeSearchText(pack.title), weight: 100, reason: "exact_name" as const },
    ...pack.aliases.map((alias) => ({
      text: normalizeSearchText(alias),
      weight: 92,
      reason: "alias" as const,
    })),
    ...pack.keywords.map((keyword) => ({
      text: normalizeSearchText(keyword),
      weight: 72,
      reason: "keyword_similarity" as const,
    })),
    { text: normalizeSearchText(pack.category), weight: 20, reason: "keyword_similarity" as const },
    { text: normalizeSearchText(pack.description), weight: 12, reason: "keyword_similarity" as const },
  ];

  if (pack.slug === querySlug) {
    const matchedTokens = [...tokens(query)];
    return { matchedTokens, missingTokens: [], score: 150, reason: "exact_name" };
  }

  let best: PackScore = emptyScore();
  const queryTokens = tokens(query);
  const packTokens = tokens(`${pack.title} ${pack.aliases.join(" ")} ${pack.category} ${pack.description} ${pack.keywords.join(" ")}`);
  const tokenMatch = significantTokenMatch(queryTokens, packTokens);
  const queryProviders = [...queryTokens].filter((token) => providers.has(token));
  const queryLocations = [...queryTokens].filter((token) => locations.has(token));
  const providerlessQueryTokens = new Set([...queryTokens].filter((token) => !providers.has(token) && !locations.has(token)));
  const hasMatchingLocation = queryLocations.some((token) => packTokens.has(token));

  const purposeScore = scorePurposeMatch(providerlessQueryTokens, packTokens);
  if ([...providerlessQueryTokens].some((token) => specificVehicleTerms.has(token) && packTokens.has(token))) {
    best = maxScore(best, { score: 90, reason: "keyword_similarity" });
  }
  if (purposeScore >= 4 && (!queryLocations.length || hasMatchingLocation)) {
    best = maxScore(best, { score: 82, reason: "keyword_similarity" });
  }
  if (queryProviders.length && purposeScore >= 2) best = maxScore(best, { score: 86, reason: "provider_purpose" });
  if (hasMatchingLocation && purposeScore >= 2) best = maxScore(best, { score: 84, reason: "location_purpose" });

  for (const item of haystacks) {
    if (!item.text) continue;
    if (item.text === normalizedQuery) best = maxScore(best, { score: item.weight, reason: item.reason });
    if (item.text.includes(normalizedQuery) || normalizedQuery.includes(item.text)) {
      best = maxScore(best, { score: item.weight - 10, reason: item.reason });
    }

    const itemTokens = tokens(item.text);
    const overlap = [...queryTokens].filter((token) => itemTokens.has(token)).length;
    if (overlap) {
      const coverage = overlap / Math.max(queryTokens.size, itemTokens.size, 1);
      best = maxScore(best, { score: Math.round(item.weight * coverage), reason: item.reason });
    }

    const compactQuery = normalizedQuery.replace(/\s+/g, "");
    const compactItem = item.text.replace(/\s+/g, "");
    if (compactItem.includes(compactQuery) || compactQuery.includes(compactItem)) {
      best = maxScore(best, { score: item.weight - 16, reason: item.reason });
    }
  }

  best = {
    ...best,
    matchedTokens: tokenMatch.matchedTokens,
    missingTokens: tokenMatch.missingTokens,
  };

  if (!tokenMatch.acceptsPartial && tokenMatch.missingTokens.length) {
    return {
      ...best,
      score: Math.min(best.score, tokenMatch.onlyGenericMatched ? 15 : 35),
      reason: best.reason,
    };
  }

  return best;
}

function maxScore(left: PackScore, right: Pick<PackScore, "reason" | "score">) {
  return right.score > left.score ? { ...left, ...right } : left;
}

function scorePurposeMatch(queryTokens: Set<string>, packTokens: Set<string>) {
  let best = 0;
  for (const terms of Object.values(purposeAliases)) {
    const queryHits = terms.filter((term) => queryTokens.has(term)).length;
    const packHits = terms.filter((term) => packTokens.has(term)).length;
    if (queryHits && packHits) best = Math.max(best, queryHits + packHits);
  }
  return best;
}

function emptyScore(): PackScore {
  return { matchedTokens: [], missingTokens: [], score: 0, reason: null };
}

function significantTokenMatch(queryTokens: Set<string>, packTokens: Set<string>) {
  const significantTokens = [...queryTokens].filter((token) => token.length > 2);
  const requiredTokens = significantTokens.filter((token) => !genericIntentTokens.has(token));
  const tokensToMatch = requiredTokens.length ? [...new Set([...requiredTokens, ...significantTokens.filter((token) => genericIntentTokens.has(token))])] : significantTokens;
  const matchedTokens = tokensToMatch.filter((token) => packTokens.has(token) || equivalentTokenMatched(token, packTokens));
  const missingTokens = tokensToMatch.filter((token) => !matchedTokens.includes(token));
  const genericMatches = matchedTokens.filter((token) => genericIntentTokens.has(token));
  return {
    acceptsPartial: requiredTokens.length === 0,
    matchedTokens,
    missingTokens,
    onlyGenericMatched: matchedTokens.length > 0 && genericMatches.length === matchedTokens.length,
  };
}

function equivalentTokenMatched(token: string, packTokens: Set<string>) {
  const equivalents: Record<string, string[]> = {
    demat: ["brokerage", "trading"],
    trading: ["brokerage", "demat"],
    account: ["account"],
    us: ["usa"],
    usa: ["us"],
    uk: ["britain", "british"],
  };
  return (equivalents[token] ?? []).some((equivalent) => packTokens.has(equivalent));
}
