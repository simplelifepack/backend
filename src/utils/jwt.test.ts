import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken } from "./jwt";
test("only accepts the access-token signing algorithm", () => {
  assert.equal(verifyAccessToken(signAccessToken({sub:"audit-user"})).sub,"audit-user");
  const secret=process.env.JWT_SECRET || "lifepack-dev-secret";
  for (const algorithm of ["HS384","HS512"] as const) assert.throws(()=>verifyAccessToken(jwt.sign({sub:"audit-user"},secret,{algorithm})));
  assert.throws(()=>verifyAccessToken(jwt.sign({sub:"audit-user"},secret,{expiresIn:-1})));
  assert.throws(()=>verifyAccessToken(jwt.sign({sub:"audit-user"},secret)));
  for (const claims of [{issuer:"other-service",audience:"readines-clients"},{issuer:"readines-backend",audience:"other-client"}]) assert.throws(()=>verifyAccessToken(jwt.sign({sub:"audit-user"},secret,{...claims,expiresIn:300})));
  assert.throws(()=>verifyAccessToken(signAccessToken({sub:"audit-user"})+"tampered"));
});
