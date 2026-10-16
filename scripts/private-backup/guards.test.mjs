import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExactBlockAllRule } from './guards.mjs';

function rule() {
  return { active: true, action: { mitigate: { action: 'deny', actionDuration: null } },
    conditionGroup: [{ conditions: [{ op: 'pre', type: 'path', value: '/' }] }] };
}
test('accepts Vercel-normalized field ordering and rejects traffic exceptions', () => {
  assert.equal(isExactBlockAllRule(rule()), true);
  for (const alter of [
    value => { value.active = false; },
    value => { value.action.mitigate.action = 'log'; },
    value => { value.conditionGroup[0].conditions[0].neg = true; },
    value => { value.conditionGroup[0].conditions[0].value = '/api'; },
    value => { value.conditionGroup[0].conditions.push({ type: 'ip_address', op: 'eq', value: '127.0.0.1' }); },
    value => { value.conditionGroup.push({ conditions: [] }); },
  ]) {
    const candidate = rule(); alter(candidate);
    assert.equal(isExactBlockAllRule(candidate), false);
  }
});
