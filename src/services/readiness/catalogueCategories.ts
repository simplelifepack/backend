/** Categories remain available for imported rows without prototype provenance. */
export function catalogueCategories(rows: Array<{ category: string; searchMetadata: unknown }>) {
  const byCategory = new Map<string, { order: number; title: string }>();
  for (const row of rows) {
    if (!row.category?.trim()) continue;
    const metadata = row.searchMetadata && typeof row.searchMetadata === "object"
      ? row.searchMetadata as Record<string, unknown> : {};
    const order = typeof metadata.categoryOrder === "number" && Number.isFinite(metadata.categoryOrder)
      ? metadata.categoryOrder : Number.POSITIVE_INFINITY;
    const title = row.category.trim();
    const existing = byCategory.get(title);
    if (!existing || order < existing.order) byCategory.set(title, { order, title });
  }
  return [...byCategory.values()].sort((left, right) => (left.order - right.order) || left.title.localeCompare(right.title)).map(item => item.title);
}
