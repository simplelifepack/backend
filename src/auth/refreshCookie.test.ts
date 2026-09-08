import assert from "node:assert/strict";
import { clearRefreshCookie, readRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "./refreshCookie";

function response() {
  const values: string[] = [];
  return { values, append: (_name: string, value: string) => { values.push(value); } };
}

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const production = response();
setRefreshCookie(production as never, "secret-refresh-token");
assert.match(production.values[0]!, new RegExp(`^${REFRESH_COOKIE_NAME}=`));
assert.match(production.values[0]!, /HttpOnly/);
assert.match(production.values[0]!, /Secure/);
assert.match(production.values[0]!, /SameSite=Lax/);
assert.match(production.values[0]!, /Path=\/auth/);
assert.match(production.values[0]!, /Max-Age=2592000/);

const cleared = response();
clearRefreshCookie(cleared as never);
assert.match(cleared.values[0]!, /Max-Age=0/);
assert.equal(readRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=rotated-token; other=value` } } as never), "rotated-token");
process.env.NODE_ENV = originalNodeEnv;

// Compatibility: existing LifePack cookies rotate into the new name without logout.
assert.equal(readRefreshCookie({ headers: { cookie: 'lifepack_refresh=legacy-session' } } as never), 'legacy-session');
assert.equal(readRefreshCookie({ headers: { cookie: `lifepack_refresh=old; ${REFRESH_COOKIE_NAME}=new` } } as never), 'new');
assert.equal(readRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=%ZZ` } } as never), null);
assert.ok(production.values.some(value => value.startsWith('lifepack_refresh=') && value.includes('Max-Age=0')));
assert.equal(cleared.values.length, 2);
