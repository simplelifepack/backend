import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TokenPayload } from 'google-auth-library';
import { verifyGoogleCredential } from './googleIdentity.service';
test('accepts only configured website and mobile audiences with verified identities', async () => {
  const original = { web: process.env.GOOGLE_CLIENT_ID, mobile: process.env.GOOGLE_MOBILE_CLIENT_ID };
  process.env.GOOGLE_CLIENT_ID = 'website';
  process.env.GOOGLE_MOBILE_CLIENT_ID = 'mobile';
  const payload = (aud: string): TokenPayload => ({ iss: 'accounts.google.com', aud, sub: 'subject', email: 'qa@example.test', email_verified: true, iat: 1, exp: 2 });
  try {
    for (const audience of ['website', 'mobile']) {
      assert.equal((await verifyGoogleCredential({ credential: 'signed-token' }, async () => payload(audience))).email, 'qa@example.test');
    }
    await assert.rejects(verifyGoogleCredential({ credential: 'signed-token' }, async () => payload('untrusted')), /Invalid Google account/);
    await assert.rejects(verifyGoogleCredential({ credential: 'signed-token' }, async () => ({ ...payload('mobile'), email_verified: false })), /Invalid Google account/);
    await assert.rejects(verifyGoogleCredential({ credential: 'bad-signature' }, async () => { throw new Error('signature'); }), /Invalid Google credential/);
  } finally {
    for (const [key, value] of [['GOOGLE_CLIENT_ID', original.web], ['GOOGLE_MOBILE_CLIENT_ID', original.mobile]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
