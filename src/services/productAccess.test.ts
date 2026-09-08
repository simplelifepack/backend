import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { getTrustCenter } from './trustCenter.service';
import { listWealthRecords } from './wealthRecords.service';
import { requireAuth } from '../middleware/requireAuth';

async function run() {
  const restore = [prisma.user.findUnique, prisma.trustMember.findMany, prisma.wealthRecord.findMany, prisma.$queryRaw];
  try {
    prisma.user.findUnique = (async () => ({ id: 'member', name: 'Member', email: 'member@example.com' })) as never;
    prisma.trustMember.findMany = (async () => []) as never;
    prisma.wealthRecord.findMany = (async (query: { where: { ownerUserId: string } }) => {
      assert.equal(query.where.ownerUserId, 'member');
      return [];
    }) as never;
    prisma.$queryRaw = (async () => [{ exists: true }]) as never;
    const trust = await getTrustCenter('member');
    assert.equal(trust.owner?.id, 'member');
    for (const field of ['plan', 'entitlements', 'memberLimit', 'remainingSlots', 'subscription']) assert.equal(field in trust, false);
    assert.deepEqual(await listWealthRecords('member'), []);
    let status = 0;
    let nextCalled = false;
    const response = { status: (value: number) => { status = value; return response; }, json: () => response };
    await requireAuth({ headers: {} } as never, response as never, () => { nextCalled = true; });
    assert.equal(status, 401);
    assert.equal(nextCalled, false);
    console.log('Product access: Trust and Wealth work without subscriptions; anonymous access rejected.');
  } finally {
    prisma.user.findUnique = restore[0] as never;
    prisma.trustMember.findMany = restore[1] as never;
    prisma.wealthRecord.findMany = restore[2] as never;
    prisma.$queryRaw = restore[3] as never;
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
