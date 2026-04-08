// /workspace/queue-server/queue/manager.js
class QueueManager {
  constructor() {
    this.tasks = new Map(); // id -> task details
    this.pendingQueue = []; // array of task ids
  }

  addTask(prompt, options = {}) {
    const id = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5);
    const task = {
      id,
      prompt,
      options,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.tasks.set(id, task);
    this.pendingQueue.push(id);
    return task;
  }

  updateTask(id, updates) {
    if (!this.tasks.has(id)) {
      return null;
    }
    const task = this.tasks.get(id);
    const updatedTask = {
      ...task,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  getTask(id) {
    return this.tasks.get(id);
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getNextPendingTask() {
    if (this.pendingQueue.length === 0) {
      return null;
    }
    const id = this.pendingQueue.shift();
    const task = this.tasks.get(id);
    if (task && task.status === 'pending') {
      return task;
    }
    // If it was cancelled or not pending anymore, try next
    return this.getNextPendingTask();
  }
}

// Singleton instance
const queueManager = new QueueManager();
module.exports = queueManager;
