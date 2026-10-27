import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration, withPrivateUser } from "../privacy/access";

// Local-only, synthetic records. No migrations, files, sharing or existing data changes.
const position = process.argv.indexOf("--env-file");
configureNormalLocalBackend(position >= 0 ? process.argv[position + 1] : undefined);
const ids = [randomUUID(), randomUUID()];
const raw = new PrismaClient({ log: [] });
async function run() {
  const { prisma } = await import("../lib/prisma");
  const { signAccessToken } = await import("../utils/jwt");
  const { app } = await import("../app");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = signAccessToken({ sub: ids[0] });
  const request = (path: string, body?: unknown, method = "POST") => fetch(`${origin}/documents${path}`, {
    method: body ? method : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    await withPrivateMigration("synthetic assignment verification", () => prisma.user.createMany({ data: ids.map(id => ({ id, name: "Synthetic owner", email: `${id}@example.test`, aiProcessingEnabled: false })) }));
    const fixtures = [];
    for (const userId of ids) fixtures.push(await withPrivateUser(userId, async () => ({
      document: await prisma.document.create({ data: { ownerProfileId: userId, originalName: "synthetic.pdf", storedName: "synthetic", path: "", mimeType: "application/pdf", size: 0, documentType: "Report", category: "medical", analysisSource: "manual", confidence: 0, fields: { patientName: "Original synthetic", reviewFields: [{ label: "Note", value: "Preserved" }] } } }),
      member: await prisma.trustMember.create({ data: { ownerUserId: userId, name: `Synthetic family ${userId}`, email: `${randomUUID()}@example.test`, relation: "OTHER", dateOfBirth: "2000-01-01", bloodGroup: "O+", accessType: "FAMILY_MEMBER", status: "ACTIVE" } }),
    })));
    const own = fixtures[0], foreign = fixtures[1];
    const options = await request("/assignment-options");
    assert.equal(options.status, 200);
    assert.deepEqual((await options.json()).map((person: { id: string }) => person.id), [ids[0], own.member.id]);
    const assigned = await request("/bulk-assign", { ids: [own.document.id], assigneeId: own.member.id });
    assert.equal(assigned.status, 200);
    const response = await assigned.json();
    assert.equal(response.documents[0].fields.assignedPerson.name, own.member.name);
    const persisted = await (await request(`/${own.document.id}`)).json();
    assert.equal(persisted.fields.assignedPerson.id, own.member.id);
    assert.equal(persisted.fields.patientName, "Original synthetic");
    assert.deepEqual(persisted.fields.reviewFields, [{ label: "Note", value: "Preserved" }]);
    assert.equal(persisted.ownerProfileId, ids[0]);
    const details = await request(`/${own.document.id}/details`, { notes: "Synthetic family note", expiry: "2027-07-02" }, "PATCH");
    assert.equal(details.status, 200);
    const reread = await (await request(`/${own.document.id}`)).json();
    assert.equal(reread.fields.documentNotes, "Synthetic family note");
    assert.equal(reread.fields.userExpiry, "2027-07-02");
    assert.equal(reread.fields.assignedPerson.id, own.member.id);
    assert.equal((await request(`/${foreign.document.id}/details`, { notes: "Forbidden" }, "PATCH")).status, 404);
    const encrypted = await raw.document.findUniqueOrThrow({ where: { id: own.document.id } });
    assert(encrypted.private_fields?.startsWith("enc:v2:"));
    assert(!JSON.stringify(encrypted).includes(own.member.name));
    assert.equal((await request("/bulk-assign", { ids: [own.document.id], assigneeId: foreign.member.id })).status, 404);
    assert.equal((await request("/bulk-assign", { ids: [own.document.id, foreign.document.id], assigneeId: ids[0] })).status, 404);
    const unchanged = await (await request(`/${own.document.id}`)).json();
    assert.equal(unchanged.fields.assignedPerson.id, own.member.id);
    const self = await request("/bulk-assign", { ids: [own.document.id], assigneeId: ids[0] });
    assert.equal(self.status, 200);
    assert.equal((await self.json()).documents[0].fields.assignedPerson.id, ids[0]);
    console.log("PASS: assignment HTTP, reread persistence, ciphertext, metadata preservation, self/family options and cross-account atomic rejection.");
  } finally {
    await raw.document.deleteMany({ where: { ownerProfileId: { in: ids } } });
    await raw.user.deleteMany({ where: { id: { in: ids } } });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await Promise.all([raw.$disconnect(), prisma.$disconnect()]);
  }
}
run().catch(() => { console.error("Assignment verification failed."); process.exitCode = 1; });
