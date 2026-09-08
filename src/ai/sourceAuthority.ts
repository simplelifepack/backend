export const SOURCE_AUTHORITY_ORDER = {
  government: 1,
  authority: 2,
  official: 3,
  bank: 4,
  university: 3,
  insurance: 4,
  commercial: 4,
  aggregator: 5,
} as const;

export type SourceAuthorityTier = keyof typeof SOURCE_AUTHORITY_ORDER;

export function rankSources<T extends { type: SourceAuthorityTier }>(sources: T[]): T[] {
  return [...sources].sort((left, right) =>
    SOURCE_AUTHORITY_ORDER[left.type] - SOURCE_AUTHORITY_ORDER[right.type]);
}
