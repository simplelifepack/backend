import {
  searchDocuments,
  searchHealth,
  searchPackages,
  searchTrustMembers,
  searchWealth,
} from "./globalSearchSources.service";

const DEFAULT_SECTION_LIMIT = 5;
const MAX_SECTION_LIMIT = 10;

export type GlobalSearchSection =
  | "packages"
  | "documents"
  | "health"
  | "wealth"
  | "family"
  | "trust";

export type GlobalSearchResult = {
  id: string;
  title: string;
  subtitle: string;
  section: GlobalSearchSection;
  navigation: {
    path: string;
  };
  score: number;
};

export type GlobalSearchGroup = {
  section: GlobalSearchSection;
  label: string;
  results: Array<Omit<GlobalSearchResult, "score">>;
};

const sectionLabels: Record<GlobalSearchSection, string> = {
  documents: "Documents",
  family: "Family",
  health: "Health",
  packages: "Packages",
  trust: "Trust Center",
  wealth: "Wealth",
};

function cleanQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").slice(0, 160);
}

function cleanResult({ score: _score, ...result }: GlobalSearchResult) {
  return result;
}

function group(section: GlobalSearchSection, results: GlobalSearchResult[]): GlobalSearchGroup {
  return {
    section,
    label: sectionLabels[section],
    results: results.map(cleanResult),
  };
}

export async function searchReadinessData(userId: string, rawQuery: string, rawLimit?: number) {
  const query = cleanQuery(rawQuery);
  if (!query) return { query, groups: [] };
  const limit = Math.min(Math.max(rawLimit ?? DEFAULT_SECTION_LIMIT, 1), MAX_SECTION_LIMIT);
  const [packages, documents, health, wealth, family, trust] = await Promise.all([
    searchPackages(userId, query, limit),
    searchDocuments(userId, query, limit),
    searchHealth(userId, query, limit),
    searchWealth(userId, query, limit),
    searchTrustMembers(userId, query, limit, "family"),
    searchTrustMembers(userId, query, limit, "trust"),
  ]);
  return {
    query,
    groups: [
      group("packages", packages),
      group("documents", documents),
      group("health", health),
      group("wealth", wealth),
      group("family", family),
      group("trust", trust),
    ],
  };
}
