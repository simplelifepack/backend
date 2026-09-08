import assert from "node:assert/strict";
import test from "node:test";
import { scorePackDetailed } from "./readinessScoring";

const pack = (title: string, aliases: string[] = []) => ({ slug: title.toLowerCase().replace(/ /g, "-"), title, aliases, keywords: [], category: "", description: "" });
const catalogue = [pack("Home Loan", ["housing loan"]), pack("Car Loan"), pack("Bike Loan"), pack("Passport Renewal"), pack("Canada Visitor Visa")];

for (const [query, expected] of [["home loan", "Home Loan"], ["new home loan", "Home Loan"], ["documents for home loan", "Home Loan"], ["apply for home loan", "Home Loan"], ["housing loan", "Home Loan"], ["new car loan", "Car Loan"], ["bike loan documents", "Bike Loan"], ["passport renewal requirements", "Passport Renewal"], ["canada visitor visa documents", "Canada Visitor Visa"]]) {
  test(`${query} resolves to ${expected}`, () => {
    const best = catalogue.map((item) => ({ item, score: scorePackDetailed(item, query).score })).sort((a, b) => b.score - a.score)[0];
    assert.equal(best?.item.title, expected); assert.ok((best?.score ?? 0) >= 70);
  });
}
for (const [query, rejected] of [["education loan", "Home Loan"], ["business loan", "Car Loan"], ["student visa", "Canada Visitor Visa"]]) {
  test(`${query} does not resolve to ${rejected}`, () => { assert.equal(scorePackDetailed(catalogue.find((item) => item.title === rejected)!, query).score, 0); });
}

for (const [query, expected] of [["vehicle registration transfer telangana", "Vehicle Registration Transfer Telangana"], ["i want to apply for vehicle registration transfer telangana again", "Vehicle Registration Transfer Telangana"], ["can i transfer vehicle registration in telangana", "Vehicle Registration Transfer Telangana"], ["how do i get a home loan", "Home Loan"], ["i need documents for canada visitor visa", "Canada Visitor Visa"], ["want to apply for passport renewal", "Passport Renewal"], ["what documents are needed for bike loan", "Bike Loan"]]) {
  test(`natural language: ${query}`, () => { const candidate = pack(expected); const result = scorePackDetailed(candidate, query); assert.equal(result.packageCoverage, 1); assert.ok(result.score >= 100); });
}

test("location-specific tokens remain distinguishing", () => {
  const candidate = { ...pack("Vehicle Registration Transfer Telangana"), searchMetadata: { jurisdiction: "Telangana", searchPhrases: [] } };
  const result = scorePackDetailed(candidate, "vehicle registration transfer andhra");
  assert.equal(result.score, 0); assert.equal(result.packageCoverage, 0);
});

for (const [query, rejected] of [["vehicle transfer andhra", "PF Transfer"], ["car insurance", "Travel Insurance"], ["buying a house with cash", "Home Loan"], ["business loan", "Business Visa"], ["education loan", "Home Loan"], ["student visa", "Visitor Visa"], ["vehicle transfer andhra", "Vehicle Registration Transfer Telangana"]]) {
  test(`intent conflict: ${query} rejects ${rejected}`, () => { const candidate = { ...pack(rejected), searchMetadata: rejected.includes("Telangana") ? { jurisdiction: "Telangana", searchPhrases: [] } : undefined }; assert.equal(scorePackDetailed(candidate, query).score, 0); });
}

for (const [query, expected] of [["thought of buying a new car on loan", "Car Loan"], ["how do i get a home loan", "Home Loan"], ["i want to apply for vehicle registration transfer telangana again", "Vehicle Registration Transfer Telangana"], ["want to transfer my PF", "PF Transfer"], ["apply for a credit card", "Credit Card Application"]]) {
  test(`intent match: ${query} resolves to ${expected}`, () => { assert.ok(scorePackDetailed(pack(expected), query).score >= 70); });
}

test("a single generic domain token is weak evidence", () => { assert.equal(scorePackDetailed(pack("Travel Insurance"), "car insurance").score, 0); });
test("isolated metadata keywords cannot create a confident result", () => {
  const candidate = { ...pack("Vehicle Hypothecation"), keywords: ["car", "insurance"] };
  assert.ok(scorePackDetailed(candidate, "car insurance").score < 70);
});

for (const [query, title, searchMetadata] of [
  ["want to purchase a bike with finance", "Bike Loan", { intent: "vehicle financing", subject: "bike", searchPhrases: ["buy a bike with finance", "purchase a bike with finance"] }],
  ["need a card from bank for spending", "Credit Card Application", { intent: "credit card", subject: "credit card", searchPhrases: ["card from bank for spending"] }],
  ["changing ownership of my car in telangana", "Vehicle Registration Transfer Telangana", { intent: "vehicle ownership transfer", subject: "vehicle", jurisdiction: "Telangana", searchPhrases: ["changing ownership of my car in telangana"] }],
  ["going to germany for vacation", "Schengen Visa", { intent: "tourist travel", subject: "visitor visa", destination: "Germany", purpose: "tourism", searchPhrases: ["going to germany for vacation"] }],
] as const) test(`structured metadata: ${query}`, () => { assert.ok(scorePackDetailed({ ...pack(title), searchMetadata }, query).score >= 100); });

test("broad card search permits multiple candidates", () => {
  for (const title of ["Aadhaar Card", "PAN Card", "Credit Card Application", "Senior Citizen Card"]) assert.ok(scorePackDetailed(pack(title), "cards").score >= 70);
});
