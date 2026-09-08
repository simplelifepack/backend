export type PackageSearchMetadata = {
  intent?: string;
  searchPhrases: string[];
  jurisdiction?: string;
  destination?: string;
  purpose?: string;
  subject?: string;
};

export function packageSearchMetadata(value: unknown, fallback: { aliases: string[]; category: string; title: string }): PackageSearchMetadata {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    intent: clean(input.intent) || fallback.category,
    subject: clean(input.subject) || fallback.title,
    purpose: clean(input.purpose) || undefined,
    destination: clean(input.destination) || undefined,
    jurisdiction: clean(input.jurisdiction) || undefined,
    searchPhrases: Array.isArray(input.searchPhrases)
      ? input.searchPhrases.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []).slice(0, 12)
      : fallback.aliases.slice(0, 12),
  };
}

export function generatedSearchMetadata(query: string, input: Omit<PackageSearchMetadata, "searchPhrases"> & { searchPhrases?: string[] }, fallback: { category: string; title: string }) {
  return packageSearchMetadata({ ...input, searchPhrases: [query, ...(input.searchPhrases ?? [])] }, { aliases: [], ...fallback });
}

function clean(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100) : ""; }
