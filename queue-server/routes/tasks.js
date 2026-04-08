// /workspace/queue-server/routes/tasks.js
const express = require('express');
const router = express.Router();
const queueManager = require('../queue/manager');
const wsHandler = require('../websocket/handler');

// Get all tasks
router.get('/', (req, res) => {
  const tasks = queueManager.getAllTasks();
  const nextPending = tasks.find(t => t.status === 'pending') || null;
  res.json({ tasks, nextPending });
});

// Add a new task
router.post('/', (req, res) => {
  const { prompt, options } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const task = queueManager.addTask(prompt, options);
  
  // Try to assign to extension if connected
  wsHandler.triggerAssign();

  // Broadcast to web clients
  wsHandler.broadcastToWeb({
    type: 'task_added',
    task
  });

  res.status(201).json({ id: task.id, status: task.status });
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

module.exports = router;
