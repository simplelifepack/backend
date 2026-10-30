import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { withPrivateUser } from "../privacy/access";
import { createHealthMember, listHealthMembers } from "./healthMembers";
const target = new URL(process.env.DATABASE_URL || "http://invalid");
const isolated = target.hostname === "127.0.0.1" && target.port === "55439" && target.pathname === "/readines_audit_test";
test("creating a Health member preserves all accepted private profile fields", { skip: !isolated }, async () => {
  const id = randomUUID();
  await withPrivateUser(id, async () => {
    try {
      await prisma.user.create({ data: { id, name: "Synthetic audit", email: `${id}@example.test` } });
      const details = { name: "Synthetic member", relation: "Child", bloodGroup: "A+", dateOfBirth: "2000-01-01", conditions: "Synthetic condition", allergies: "Synthetic allergy", emergencyContactName: "Synthetic contact", emergencyContactPhone: "0000000000", primaryDoctor: "Synthetic doctor", insuranceProvider: "Synthetic provider", insurancePolicyNumber: "SYNTHETIC-POLICY" };
      const member = await createHealthMember(id, details);
      const stored = await prisma.healthMember.findUniqueOrThrow({ where: { id: member.id } });
      for (const key of ["conditions", "allergies", "emergencyContactName", "emergencyContactPhone", "primaryDoctor", "insuranceProvider", "insurancePolicyNumber"] as const) assert.equal(stored[key], details[key], key);
    } finally { await prisma.user.deleteMany({ where: { id } }); }
  });
});
test("concurrent initial Health requests create only one default member", { skip: !isolated }, async () => {
  const id = randomUUID();
  await withPrivateUser(id, async () => {
    try {
      await prisma.user.create({ data: { id, name: "Synthetic audit", email: `${id}@example.test` } });
      const responses = await Promise.all(Array.from({ length: 12 }, () => listHealthMembers(id, "Synthetic audit")));
      const defaults = await prisma.healthMember.findMany({ where: { userId: id, relation: "Myself" } });
      assert.equal(defaults.length, 1);
      assert(responses.every(rows => rows.filter(row => row.relation === "Myself").length === 1));
    } finally { await prisma.user.deleteMany({ where: { id } }); }
  });
});
test.after(async () => { await prisma.$disconnect(); });
