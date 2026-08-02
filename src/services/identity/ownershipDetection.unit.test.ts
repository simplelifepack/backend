import assert from "node:assert/strict";
import { compareOwnerIdentity } from "./ownershipDetection";

const exact = compareOwnerIdentity(
  { fullName: "Ravi Kumar Singh", dateOfBirth: "1990-01-02" },
  { fullName: "Singh, Ravi Kumar", dateOfBirth: "1990-01-02" },
  "profile-self",
);
assert.equal(exact.status, "verified");
assert.deepEqual(exact.matchedFields, ["fullName", "dateOfBirth"]);

const mismatch = compareOwnerIdentity(
  { fullName: "Samirskumar Mohanty", dateOfBirth: "1990-01-02" },
  { fullName: "Ravi Kumar", dateOfBirth: "1990-01-02" },
  "profile-self",
);
assert.equal(mismatch.status, "mismatch");
assert.deepEqual(mismatch.mismatchedFields, ["fullName"]);

const partial = compareOwnerIdentity(
  { fullName: "Ravi Kumar", dateOfBirth: null },
  { fullName: "Ravi Kumar", dateOfBirth: "1990-01-02" },
  "profile-self",
);
assert.equal(partial.status, "unknown");

const family = compareOwnerIdentity(
  { fullName: "Anita Kumar", dateOfBirth: "1992-03-04" },
  { fullName: "Anita Kumar", dateOfBirth: "1992-03-04" },
  "family-anita",
);
assert.equal(family.status, "verified");
assert.equal(family.targetProfileId, "family-anita");

console.log("ownership comparison unit tests passed");
