export function isExactBlockAllRule(rule) {
  const groups = rule?.conditionGroup || [];
  const conditions = groups[0]?.conditions || [];
  return rule?.active === true && rule.action?.mitigate?.action === 'deny' &&
    groups.length === 1 && conditions.length === 1 && conditions[0].type === 'path' &&
    conditions[0].op === 'pre' && conditions[0].value === '/' && !conditions[0].neg;
}
