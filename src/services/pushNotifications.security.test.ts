import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSubscription, safeInternalUrl } from "./pushNotifications.service";
import { publicSourceAddress } from "../ai/packageSourcePage";
test("push endpoints reject private network targets and unsafe URL forms", () => {
  for (const endpoint of ["https://127.0.0.1/admin","https://[::1]/","https://169.254.169.254/metadata","https://10.0.0.1/","https://2130706433/","https://localhost/","https://user:pass@example.com/","http://example.com/","https://example.com:8443/"]) assert.throws(()=>validateSubscription({endpoint,keys:{p256dh:"synthetic",auth:"synthetic"}}));
  assert.equal(validateSubscription({endpoint:"https://fcm.googleapis.com/push/token",keys:{p256dh:"synthetic",auth:"synthetic"}}).endpoint,"https://fcm.googleapis.com/push/token");
  for (const address of ["0.0.0.0","127.0.0.1","10.1.1.1","172.16.1.1","192.168.1.1","169.254.169.254","100.64.0.1","198.18.0.1","224.0.0.1","::1"]) assert.equal(publicSourceAddress(address),false);
});

test("notification links remain same-origin after browser URL normalization",()=>{
  for(const target of ["//evil.example/", "/\\evil.example/", "https://evil.example/", "javascript:alert(1)"]) assert.equal(safeInternalUrl(target),"/");
  assert.equal(safeInternalUrl("/documents?preview=one#page-2"),"/documents?preview=one#page-2");
});
