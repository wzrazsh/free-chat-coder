// /workspace/queue-server/routes/tasks.js
const express = require('express');
const router = express.Router();
const queueManager = require('../queue/manager');
const wsHandler = require('../websocket/handler');
const conversationStore = require('../conversations/store');
const providerRegistry = require('../providers');

// Get all tasks
router.get('/', (req, res) => {
  const tasks = queueManager.getAllTasks();
  const nextPending = tasks.find(t => t.status === 'pending') || null;
  res.json({ tasks, nextPending });
});

// Add a new task
router.post('/', (req, res) => {
  const { prompt, options = {} } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (options.provider && !providerRegistry.isKnownProvider(options.provider)) {
    return res.status(400).json({
      error: `Unknown provider: ${options.provider}`,
      supportedProviders: Object.keys(providerRegistry.providers)
    });
  }

  const normalizedOptions = providerRegistry.normalizeTaskOptions(options);
  const task = queueManager.addTask(prompt, normalizedOptions);

  if (task.options?.conversationId) {
    try {
      conversationStore.syncConversation(task.options.conversationId, {
        metadata: {
          lastTaskId: task.id,
          lastTaskCreatedAt: task.createdAt,
          lastTaskProvider: task.options.provider
        },
        messages: [
          {
            role: 'user',
            content: prompt,
            source: 'task_prompt',
            metadata: {
              taskId: task.id,
              attachments: task.options?.attachments || [],
              provider: task.options.provider
            }
          }
        ]
      });
    } catch (error) {
      console.warn('[TasksRoute] Failed to append prompt to conversation:', error.message);
    }
  }
  
  // Try to assign to extension if connected
  wsHandler.triggerAssign();

  // Broadcast to web clients
  wsHandler.broadcastToWeb({
    type: 'task_added',
    task
  });

  res.status(201).json({ id: task.id, status: task.status, task });
});

// Update task status (for REST fallback)
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { status, result, error } = req.body;

  const updatedTask = queueManager.updateTask(id, { status, result, error });
  if (!updatedTask) {
    return res.status(404).json({ error: 'Task not found' });
  }

  wsHandler.broadcastToWeb({
    type: 'task_update',
    task: updatedTask
  });

  // Try next if finished
  if (status === 'completed' || status === 'failed') {
    wsHandler.triggerAssign();
  }

  res.json({ success: true, task: updatedTask });
});

// ──────────────────────────────────────────────
// 人工审批接口（配合 confirm-manager.js）
// ──────────────────────────────────────────────
const confirmManager = require('../actions/confirm-manager');

// 获取待审批列表
router.get('/confirms', (req, res) => {
  res.json({ confirms: confirmManager.getPendingList() });
});

// 创建一个仅用于本地联调/验证的合成审批项
router.post('/confirms/test', (req, res) => {
  const { action, riskLevel, params, taskId } = req.body || {};
  const confirmId = confirmManager.createTestConfirm({
    action: action || 'execute_command',
    riskLevel: riskLevel || 'high',
    params: params || { command: 'whoami', cwd: '.' },
    taskId: taskId || `synthetic-${Date.now()}`
  });

  res.status(201).json({ success: true, confirmId });
});

// 响应审批（approved: true/false）
router.post('/confirms/:id', (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  const found = confirmManager.respondConfirm(id, !!approved);
  if (!found) {
    return res.status(404).json({ error: 'Confirm not found or already resolved' });
  }

  wsHandler.broadcastToWeb({
    type: 'confirm_resolved',
    confirmId: id,
    approved: !!approved
  });
  wsHandler.broadcastToExtensions({
    type: 'confirm_resolved',
    confirmId: id,
    approved: !!approved
  });

  res.json({ success: true, approved: !!approved });
});

module.exports = router;
