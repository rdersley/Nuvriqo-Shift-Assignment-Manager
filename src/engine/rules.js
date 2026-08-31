function valueAt(issue, field) {
  if (field === 'projectId') return issue.projectId;
  if (field === 'issueTypeId') return issue.issueTypeId;
  if (field === 'requestTypeId') return issue.requestTypeId;
  if (field === 'statusId') return issue.statusId;
  if (field === 'priorityId') return issue.priorityId;
  if (field === 'assigneeAccountId') return issue.assigneeAccountId;
  if (field === 'labels') return issue.labels || [];
  if (field === 'components') return issue.componentIds || [];
  return issue.fields?.[field];
}

function conditionMatches(condition, issue) {
  const actual = valueAt(issue, condition.field);
  switch (condition.operator) {
    case 'equals': return actual === condition.value;
    case 'notEquals': return actual !== condition.value;
    case 'in': return condition.values?.includes(actual) ?? false;
    case 'contains': return Array.isArray(actual) && actual.includes(condition.value);
    case 'empty': return actual == null || actual === '';
    case 'notEmpty': return !(actual == null || actual === '');
    default: throw new Error(`Unsupported operator: ${condition.operator}`);
  }
}

export function ruleMatches({ rule, trigger, issue }) {
  if (!rule.enabled || rule.trigger !== trigger) return false;
  if (rule.projectIds?.length && !rule.projectIds.includes(issue.projectId)) return false;
  return (rule.conditions || []).every(c => conditionMatches(c, issue));
}

export function matchingRules({ rules, trigger, issue }) {
  return rules
    .filter(rule => ruleMatches({ rule, trigger, issue }))
    .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
}
