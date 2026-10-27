import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueCategories } from "./catalogueCategories";
test("retains imported categories without prototype metadata, deduplicates and preserves reference order", () => {
  assert.deepEqual(catalogueCategories([
    { category: "Health", searchMetadata: null },
    { category: "Education", searchMetadata: { referenceSource: "import" } },
    { category: "Travel", searchMetadata: { categoryOrder: 2 } },
    { category: "Identity", searchMetadata: { categoryOrder: 1 } },
    { category: "Travel", searchMetadata: {} },
    { category: "", searchMetadata: {} },
  ]), ["Identity", "Travel", "Education", "Health"]);
});
