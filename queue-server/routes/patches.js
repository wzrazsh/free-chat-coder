/**
 * Patches API Routes
 * 
 * 提供 patch 提案的 REST API
 */
const express = require('express');
const router = express.Router();
const patchStore = require('../storage/patch-store');
const patchParser = require('../actions/patch-parser');
const { validatePatch } = require('../storage/patch-store');

/**
 * GET /api/patches
 * 获取 patch 列表
 */
router.get('/', (req, res) => {
  try {
    const filters = {
      taskId: req.query.taskId,
      status: req.query.status,
      conversationId: req.query.conversationId,
      limit: req.query.limit ? parseInt(req.query.limit) : 50,
      offset: req.query.offset ? parseInt(req.query.offset) : 0
    };

    const patches = patchStore.getPatches(filters);
    res.json({ success: true, data: patches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/patches/:id
 * 获取单个 patch 详情
 */
router.get('/:id', (req, res) => {
  try {
    const patch = patchStore.getPatch(req.params.id);
    
    if (!patch) {
      return res.status(404).json({ success: false, error: 'Patch not found' });
    }

    res.json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/patches/:id/diff
 * 获取 patch 的 diff 预览
 */
router.get('/:id/diff', (req, res) => {
  try {
    const diff = patchStore.getPatchDiff(req.params.id);
    
    if (!diff) {
      return res.status(404).json({ success: false, error: 'Patch not found' });
    }

    res.json({ success: true, data: diff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/patches/:id/events
 * 获取 patch 事件历史
 */
router.get('/:id/events', (req, res) => {
  try {
    const events = patchStore.getPatchEvents(req.params.id);
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches
 * 创建 patch 提案
 */
router.post('/', (req, res) => {
  try {
    const patchData = {
      taskId: req.body.taskId,
      conversationId: req.body.conversationId,
      summary: req.body.summary,
      changes: req.body.changes,
      riskLevel: req.body.riskLevel || 'medium',
      source: req.body.source || 'api'
    };

    const patch = patchStore.createPatch(patchData);
    res.status(201).json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches/from-message
 * 从 DeepSeek 消息中解析并创建 patch
 */
router.post('/from-message', (req, res) => {
  try {
    const { message, conversationId, taskId } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // 检测是否包含 patch
    if (!patchParser.hasPatchProposal(message)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message does not contain a patch proposal' 
      });
    }

    // 解析 patch
    const parsed = patchParser.parsePatchProposal(message);
    
    if (!parsed) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to parse patch proposal' 
      });
    }

    // 创建 patch
    const patch = patchStore.createPatch({
      ...parsed,
      conversationId,
      taskId
    });

    res.status(201).json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches/:id/validate
 * 验证 patch 安全性
 */
router.post('/:id/validate', (req, res) => {
  try {
    const result = patchStore.validatePatch(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches/:id/approve
 * 批准 patch
 */
router.post('/:id/approve', (req, res) => {
  try {
    const patch = patchStore.updatePatchStatus(
      req.params.id, 
      'approved', 
      req.body.reason || 'Approved by user'
    );

    if (!patch) {
      return res.status(404).json({ success: false, error: 'Patch not found' });
    }

    res.json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches/:id/reject
 * 拒绝 patch
 */
router.post('/:id/reject', (req, res) => {
  try {
    const patch = patchStore.updatePatchStatus(
      req.params.id, 
      'rejected', 
      req.body.reason || 'Rejected by user'
    );

    if (!patch) {
      return res.status(404).json({ success: false, error: 'Patch not found' });
    }

    res.json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/patches/:id/apply
 * 应用 patch 到文件系统
 */
router.post('/:id/apply', async (req, res) => {
  try {
    const result = patchStore.applyPatch(req.params.id);
    
    if (!result.success) {
      return res.status(400).json({ success: false, data: result });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/patches/:id
 * 删除 patch
 */
router.delete('/:id', (req, res) => {
  try {
    const patch = patchStore.updatePatchStatus(
      req.params.id, 
      'deleted', 
      'Deleted by user'
    );

    if (!patch) {
      return res.status(404).json({ success: false, error: 'Patch not found' });
    }

    res.json({ success: true, data: patch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;