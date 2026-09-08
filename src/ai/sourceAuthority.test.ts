import assert from "node:assert/strict";
import { rankSources } from "./sourceAuthority";

const ranked = rankSources([
  { type: "aggregator" as const, name: "Aggregator" },
  { type: "government" as const, name: "Government" },
  { type: "authority" as const, name: "Regulator" },
]);
assert.deepEqual(ranked.map((source) => source.name), ["Government", "Regulator", "Aggregator"]);
