const TASK_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const TASK_STATUS_LABELS = {
  pending: 'Pending',
  assigned: 'Assigned',
  running: 'Running',
  waiting_approval: 'Awaiting Approval',
  completed: 'Completed',
  failed: 'Failed'
};

const TASK_STATUS_COLORS = {
  pending: 'slate',
  assigned: 'sky',
  running: 'sky',
  waiting_approval: 'amber',
  completed: 'emerald',
  failed: 'rose'
};

const LEGAL_TRANSITIONS = {
  [TASK_STATUS.PENDING]: [TASK_STATUS.ASSIGNED],
  [TASK_STATUS.ASSIGNED]: [TASK_STATUS.RUNNING, TASK_STATUS.FAILED],
  [TASK_STATUS.RUNNING]: [TASK_STATUS.WAITING_APPROVAL, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED],
  [TASK_STATUS.WAITING_APPROVAL]: [TASK_STATUS.RUNNING, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED],
  [TASK_STATUS.COMPLETED]: [],
  [TASK_STATUS.FAILED]: [TASK_STATUS.PENDING]
};

function isValidTransition(from, to) {
  const allowed = LEGAL_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function isTerminal(status) {
  return status === TASK_STATUS.COMPLETED || status === TASK_STATUS.FAILED;
}

function isActive(status) {
  return status === TASK_STATUS.ASSIGNED || status === TASK_STATUS.RUNNING || status === TASK_STATUS.WAITING_APPROVAL;
}

function formatBadTransitionError(from, to, taskId) {
  const allowed = (LEGAL_TRANSITIONS[from] || []).join(', ');
  return `Illegal status transition from "${from}" to "${to}" for task ${taskId}. Allowed: ${allowed || 'none (terminal)'}`;
}

module.exports = {
  TASK_STATUS,
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  LEGAL_TRANSITIONS,
  isValidTransition,
  isTerminal,
  isActive,
  formatBadTransitionError
};
