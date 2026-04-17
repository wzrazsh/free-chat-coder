// /workspace/queue-server/queue/manager.js
const fs = require('fs');
const path = require('path');

class QueueManager {
  constructor() {
    this.tasks = new Map(); // id -> task details
    this.pendingQueue = []; // array of task ids
    this.dataPath = path.join(__dirname, '..', 'data', 'tasks.json');
    this._initDataDirectory();
    this._loadTasks();
  }

  _initDataDirectory() {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadTasks() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        const tasksArray = JSON.parse(data);
        tasksArray.forEach(task => {
          this.tasks.set(task.id, task);
          if (task.status === 'pending') {
            this.pendingQueue.push(task.id);
          }
        });
      }
    } catch (err) {
      console.error('[QueueManager] Error loading tasks:', err);
    }
  }

  _saveTasks() {
    try {
      const tasksArray = Array.from(this.tasks.values());
      fs.writeFileSync(this.dataPath, JSON.stringify(tasksArray, null, 2), 'utf8');
    } catch (err) {
      console.error('[QueueManager] Error saving tasks:', err);
    }
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
    this._saveTasks();
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
    this._saveTasks();
    return updatedTask;
  }

  requeueTask(id, updates = {}) {
    if (!this.tasks.has(id)) {
      return null;
    }

    const updatedTask = this.updateTask(id, {
      ...updates,
      status: 'pending'
    });

    if (updatedTask && !this.pendingQueue.includes(id)) {
      this.pendingQueue.push(id);
      this._saveTasks();
    }

    return updatedTask;
  }

  requeueProcessingTasks() {
    const requeuedTasks = [];

    for (const task of this.tasks.values()) {
      if (task.status !== 'processing') {
        continue;
      }

      const requeuedTask = this.requeueTask(task.id);
      if (requeuedTask) {
        requeuedTasks.push(requeuedTask);
      }
    }

    return requeuedTasks;
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
