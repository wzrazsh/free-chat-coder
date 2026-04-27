const express = require('express');
const router = express.Router();
const approvalStore = require('../storage/approval-store');
const wsHandler = require('../websocket/handler');

router.get('/', (req, res) => {
  const { status, taskId, limit = 50, offset = 0 } = req.query;
  const approvals = approvalStore.listApprovals({ status, taskId, limit: Number(limit), offset: Number(offset) });
  res.json({ approvals, pendingCount: approvalStore.getPendingCount() });
});

router.get('/:id', (req, res) => {
  const approval = approvalStore.getApproval(req.params.id);
  if (!approval) {
    return res.status(404).json({ error: 'Approval not found' });
  }
  res.json({ approval });
});

router.post('/:id/approve', (req, res) => {
  const { reason } = req.body || {};
  const approval = approvalStore.approveApproval(req.params.id, reason || null);
  if (!approval) {
    return res.status(404).json({ error: 'Approval not found or already resolved' });
  }

  wsHandler.broadcastToWeb({
    type: 'approval_resolved',
    approvalId: approval.id,
    taskId: approval.task_id,
    status: 'approved'
  });

  res.json({ success: true, approval });
});

router.post('/:id/reject', (req, res) => {
  const { reason } = req.body || {};
  const approval = approvalStore.rejectApproval(req.params.id, reason || null);
  if (!approval) {
    return res.status(404).json({ error: 'Approval not found or already resolved' });
  }

  wsHandler.broadcastToWeb({
    type: 'approval_resolved',
    approvalId: approval.id,
    taskId: approval.task_id,
    status: 'rejected'
  });

  res.json({ success: true, approval });
});

module.exports = router;
