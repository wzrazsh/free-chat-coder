const { db } = require('./sqlite');

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const insertApproval = db.prepare(`
  INSERT INTO approvals (id, task_id, action_type, params_json, risk_level, status, reason, created_at, resolved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getById = db.prepare('SELECT * FROM approvals WHERE id = ?');

const listAll = db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ? OFFSET ?');
const listByTask = db.prepare('SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC');
const listByStatus = db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');

const resolveApproval = db.prepare(`
  UPDATE approvals SET status = ?, reason = ?, resolved_at = ? WHERE id = ? AND status = 'pending'
`);

const countPending = db.prepare("SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'");

function createApproval({ taskId, actionType, params, riskLevel = 'medium' }) {
  const id = generateId('appr');
  const now = new Date().toISOString();
  insertApproval.run(id, taskId, actionType, JSON.stringify(params), riskLevel, 'pending', null, now, null);
  return getById.get(id);
}

function getApproval(id) {
  return getById.get(id) || null;
}

function listApprovals({ status, taskId, limit = 50, offset = 0 } = {}) {
  if (taskId) {
    return listByTask.all(taskId);
  }
  if (status) {
    return listByStatus.all(status, limit, offset);
  }
  return listAll.all(limit, offset);
}

function approveApproval(id, reason = null) {
  const now = new Date().toISOString();
  const result = resolveApproval.run('approved', reason || null, now, id);
  if (result.changes === 0) {
    return null;
  }
  return getById.get(id);
}

function rejectApproval(id, reason = null) {
  const now = new Date().toISOString();
  const result = resolveApproval.run('rejected', reason || null, now, id);
  if (result.changes === 0) {
    return null;
  }
  return getById.get(id);
}

function getPendingCount() {
  const row = countPending.get();
  return row ? row.count : 0;
}

module.exports = {
  createApproval,
  getApproval,
  listApprovals,
  approveApproval,
  rejectApproval,
  getPendingCount
};
