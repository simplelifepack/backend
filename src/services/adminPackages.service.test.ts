import assert from "node:assert/strict";
import test from "node:test";

import { packageAdminInputSchema } from "./adminPackages.service";

const basePackage = {
  category: "life",
  description: "make the best coffee",
  requirements: [{
    acceptedDocumentTypes: ["milk"],
    alternativeLabels: [],
    documentType: "Main",
    group: "Required",
    owner: "self",
    required: true,
    title: "Milk",
  }],
  title: "Coffee",
};

test("admin package input accepts URL accidentally sent as sourceType", () => {
  const parsed = packageAdminInputSchema.parse({
    ...basePackage,
    sourceTitle: "rush",
    sourceType: "https://www.healthline.com/nutrition/top-evidence-based-health-benefits-of-coffee",
    sourceUrl: "https://www.healthline.com/nutrition/top-evidence-based-health-benefits-of-coffee",
  });

  assert.equal(parsed.sourceType, undefined);
  assert.equal(parsed.sourceUrl, "https://www.healthline.com/nutrition/top-evidence-based-health-benefits-of-coffee");
});

test("admin package input accepts URL accidentally sent as nested source type", () => {
  const parsed = packageAdminInputSchema.parse({
    ...basePackage,
    sources: [{
      title: "Healthline",
      type: "https://www.healthline.com/nutrition/top-evidence-based-health-benefits-of-coffee",
      url: "https://www.healthline.com/nutrition/top-evidence-based-health-benefits-of-coffee",
    }],
  });

  assert.equal(parsed.sources[0]?.type, undefined);
});
