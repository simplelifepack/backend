import { normalizeSearchText, slugify } from "./normalization";

type ScoredPackFields = {
  slug: string;
  title: string;
  aliases: string[];
  category: string;
  description: string;
  keywords: string[];
};

function tokens(input: string) {
  return new Set(normalizeSearchText(input).split(" ").filter(Boolean));
}

export function scorePack(pack: ScoredPackFields, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const querySlug = slugify(query);
  if (!normalizedQuery) return 0;

  const haystacks = [
    { text: normalizeSearchText(pack.slug), weight: 115 },
    { text: normalizeSearchText(pack.title), weight: 100 },
    ...pack.aliases.map((alias) => ({
      text: normalizeSearchText(alias),
      weight: 92,
    })),
    ...pack.keywords.map((keyword) => ({
      text: normalizeSearchText(keyword),
      weight: 72,
    })),
    { text: normalizeSearchText(pack.category), weight: 20 },
    { text: normalizeSearchText(pack.description), weight: 12 },
  ];

  if (pack.slug === querySlug) return 150;

  let best = 0;
  const queryTokens = tokens(query);
  for (const item of haystacks) {
    if (!item.text) continue;
    if (item.text === normalizedQuery) best = Math.max(best, item.weight);
    if (item.text.includes(normalizedQuery) || normalizedQuery.includes(item.text)) {
      best = Math.max(best, item.weight - 10);
    }

    const itemTokens = tokens(item.text);
    const overlap = [...queryTokens].filter((token) => itemTokens.has(token)).length;
    if (overlap) {
      const coverage = overlap / Math.max(queryTokens.size, itemTokens.size, 1);
      best = Math.max(best, Math.round(item.weight * coverage));
    }

    const compactQuery = normalizedQuery.replace(/\s+/g, "");
    const compactItem = item.text.replace(/\s+/g, "");
    if (compactItem.includes(compactQuery) || compactQuery.includes(compactItem)) {
      best = Math.max(best, item.weight - 16);
    }
  }

  return best;
}
