export function shouldPreserveOwner({ currentAssignee, eligibleAccountIds, forceReassign = false }) {
  return !forceReassign && !!currentAssignee && eligibleAccountIds.includes(currentAssignee);
}

export function selectAssignee({ strategy, eligibleAccountIds, loads = {}, lastAssignedAccountId = null, fixedOrder = [] }) {
  if (!eligibleAccountIds?.length) return null;
  const eligible = [...new Set(eligibleAccountIds)];

  switch (strategy) {
    case 'leastLoaded':
      return eligible.slice().sort((a, b) => (loads[a] ?? 0) - (loads[b] ?? 0) || a.localeCompare(b))[0];
    case 'fixedOrder': {
      const found = fixedOrder.find(id => eligible.includes(id));
      return found || eligible[0];
    }
    case 'roundRobin': {
      if (!lastAssignedAccountId || !eligible.includes(lastAssignedAccountId)) return eligible[0];
      const idx = eligible.indexOf(lastAssignedAccountId);
      return eligible[(idx + 1) % eligible.length];
    }
    case 'random':
      return eligible[Math.floor(Math.random() * eligible.length)];
    default:
      throw new Error(`Unsupported assignment strategy: ${strategy}`);
  }
}

export function evaluateAssignment({ rule, issue, eligibleAccountIds, loads, lastAssignedAccountId }) {
  if (!eligibleAccountIds.length) {
    return { action: 'none', reason: 'NO_ELIGIBLE_AGENT' };
  }
  if (shouldPreserveOwner({
    currentAssignee: issue.assigneeAccountId,
    eligibleAccountIds,
    forceReassign: rule.forceReassign
  })) {
    return { action: 'keep', assigneeAccountId: issue.assigneeAccountId, reason: 'OWNER_CONTINUITY' };
  }
  const selected = selectAssignee({
    strategy: rule.assignmentStrategy,
    eligibleAccountIds,
    loads,
    lastAssignedAccountId,
    fixedOrder: rule.fixedOrder || []
  });
  return { action: 'assign', assigneeAccountId: selected, reason: `STRATEGY_${rule.assignmentStrategy}` };
}
