/**
 * 测试验证状态管理器
 * 管理验证任务状态机，支持状态持久化和幂等性保证
 */

const fs = require('fs');
const path = require('path');

/**
 * 验证任务状态枚举
 */
const ValidationState = {
  PENDING: 'pending',           // 待验证
  VALIDATING: 'validating',     // 验证中
  DECIDING: 'deciding',         // 决策中
  COMPLETED: 'completed',       // 已完成
  FAILED: 'failed',             // 失败
  ROLLED_BACK: 'rolled_back',   // 已回滚
  REVIEW_REQUIRED: 'review_required'  // 需要人工审查
};

/**
 * 状态转换配置
 */
const STATE_TRANSITIONS = {
  [ValidationState.PENDING]: [ValidationState.VALIDATING, ValidationState.FAILED],
  [ValidationState.VALIDATING]: [ValidationState.DECIDING, ValidationState.FAILED, ValidationState.ROLLED_BACK],
  [ValidationState.DECIDING]: [ValidationState.COMPLETED, ValidationState.FAILED, ValidationState.REVIEW_REQUIRED],
  [ValidationState.COMPLETED]: [ValidationState.ROLLED_BACK],  // 允许回滚
  [ValidationState.FAILED]: [ValidationState.PENDING],  // 允许重试
  [ValidationState.ROLLED_BACK]: [ValidationState.PENDING],  // 允许重试
  [ValidationState.REVIEW_REQUIRED]: [ValidationState.COMPLETED, ValidationState.FAILED]
};

/**
 * 状态管理器配置
 */
const STATE_MANAGER_CONFIG = {
  storage: {
    dataDir: path.join(__dirname, '../data'),
    stateFile: 'validation-state.json',
    backupEnabled: true,
    backupCount: 3
  },
  idemPotency: {
    enabled: true,
    ttl: 24 * 60 * 60 * 1000  // 24小时 TTL
  },
  cleanup: {
    autoCleanup: true,
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7天保留期
  }
};

/**
 * 测试验证状态管理器
 * 管理验证任务的状态转换、持久化和幂等性保证
 */
class StateManager {
  constructor(config = {}) {
    this.config = { ...STATE_MANAGER_CONFIG, ...config };
    this.state = {
      tasks: {},      // 任务ID -> 任务状态
      history: [],    // 历史记录
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        activeTasks: 0
      }
    };

    this._ensureStorageDir();
    this._loadState();
    this._startAutoSave();
  }

  /**
   * 确保存储目录存在
   * @private
   */
  _ensureStorageDir() {
    const dir = this.config.storage.dataDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 获取状态文件路径
   * @private
   */
  _getStateFilePath() {
    return path.join(this.config.storage.dataDir, this.config.storage.stateFile);
  }

  /**
   * 加载持久化状态
   * @private
   */
  _loadState() {
    const filePath = this._getStateFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const loaded = JSON.parse(data);
        this.state = { ...this.state, ...loaded };
        console.log(`[StateManager] Loaded ${Object.keys(this.state.tasks).length} tasks from storage`);
      }
    } catch (error) {
      console.error('[StateManager] Failed to load state:', error.message);
    }
  }

  /**
   * 保存状态到文件
   * @private
   */
  _saveState() {
    const filePath = this._getStateFilePath();
    try {
      // 备份旧文件
      if (this.config.storage.backupEnabled && fs.existsSync(filePath)) {
        const backupPath = `${filePath}.bak`;
        fs.copyFileSync(filePath, backupPath);
        this._rotateBackups();
      }

      fs.writeFileSync(filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      console.error('[StateManager] Failed to save state:', error.message);
    }
  }

  /**
   * 轮转备份文件
   * @private
   */
  _rotateBackups() {
    const filePath = this._getStateFilePath();
    const backupCount = this.config.storage.backupCount;

    for (let i = backupCount - 1; i > 0; i--) {
      const oldPath = `${filePath}.bak${i > 1 ? `.${i - 1}` : ''}`;
      const newPath = `${filePath}.bak${i}`;
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }
  }

  /**
   * 启动自动保存
   * @private
   */
  _startAutoSave() {
    setInterval(() => {
      this._saveState();
    }, 60000);  // 每分钟自动保存
  }

  /**
   * 创建验证任务
   * @param {string} validationId - 唯一验证ID
   * @param {Object} taskData - 任务数据
   * @returns {Object} 创建的任务
   */
  createTask(validationId, taskData) {
    // 幂等性检查
    if (this.config.idemPotency.enabled && this.state.tasks[validationId]) {
      const existing = this.state.tasks[validationId];
      // 检查 TTL
      if (Date.now() - existing.createdAt < this.config.idemPotency.ttl) {
        console.log(`[StateManager] Task ${validationId} already exists, returning existing`);
        return existing;
      }
    }

    const task = {
      id: validationId,
      state: ValidationState.PENDING,
      data: taskData,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: null,
      error: null
    };

    this.state.tasks[validationId] = task;
    this.state.stats.totalTasks++;
    this.state.stats.activeTasks++;
    this._saveState();

    return task;
  }

  /**
   * 获取任务状态
   * @param {string} validationId - 唯一验证ID
   * @returns {Object|null} 任务状态
   */
  getTask(validationId) {
    return this.state.tasks[validationId] || null;
  }

  /**
   * 获取所有任务
   * @param {Object} filter - 过滤条件
   * @returns {Array} 任务列表
   */
  getAllTasks(filter = {}) {
    let tasks = Object.values(this.state.tasks);

    if (filter.state) {
      tasks = tasks.filter(t => t.state === filter.state);
    }

    if (filter.active) {
      tasks = tasks.filter(t => ![ValidationState.COMPLETED, ValidationState.FAILED, ValidationState.ROLLED_BACK].includes(t.state));
    }

    return tasks;
  }

  /**
   * 转换任务状态
   * @param {string} validationId - 唯一验证ID
   * @param {string} newState - 新状态
   * @param {Object} metadata - 附加数据
   * @returns {boolean} 是否成功
   */
  transitionTo(validationId, newState, metadata = {}) {
    const task = this.state.tasks[validationId];
    if (!task) {
      console.error(`[StateManager] Task ${validationId} not found`);
      return false;
    }

    const currentState = task.state;
    const allowedTransitions = STATE_TRANSITIONS[currentState] || [];

    if (!allowedTransitions.includes(newState)) {
      console.error(`[StateManager] Invalid transition: ${currentState} -> ${newState}`);
      return false;
    }

    // 记录状态历史
    task.history.push({
      from: currentState,
      to: newState,
      timestamp: Date.now(),
      metadata
    });

    task.state = newState;
    task.updatedAt = Date.now();

    if (metadata.result) {
      task.result = metadata.result;
    }
    if (metadata.error) {
      task.error = metadata.error;
    }

    // 更新统计
    this._updateStats(currentState, newState);

    this._saveState();

    console.log(`[StateManager] Task ${validationId} transitioned: ${currentState} -> ${newState}`);
    return true;
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(fromState, toState) {
    const finishedStates = [ValidationState.COMPLETED, ValidationState.FAILED, ValidationState.ROLLED_BACK];

    if (finishedStates.includes(fromState) && !finishedStates.includes(toState)) {
      this.state.stats.activeTasks--;
    }
    if (!finishedStates.includes(fromState) && finishedStates.includes(toState)) {
      this.state.stats.activeTasks++;
    }

    if (toState === ValidationState.COMPLETED) {
      this.state.stats.completedTasks++;
    } else if (toState === ValidationState.FAILED) {
      this.state.stats.failedTasks++;
    }
  }

  /**
   * 更新任务结果
   * @param {string} validationId - 唯一验证ID
   * @param {Object} result - 任务结果
   */
  updateResult(validationId, result) {
    const task = this.state.tasks[validationId];
    if (task) {
      task.result = result;
      task.updatedAt = Date.now();
      this._saveState();
    }
  }

  /**
   * 标记任务失败
   * @param {string} validationId - 唯一验证ID
   * @param {string} error - 错误信息
   */
  markFailed(validationId, error) {
    const task = this.state.tasks[validationId];
    if (task) {
      task.error = error;
      task.updatedAt = Date.now();
      this.transitionTo(validationId, ValidationState.FAILED, { error });
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.state.stats,
      byState: this._getStateDistribution()
    };
  }

  /**
   * 获取状态分布
   * @private
   */
  _getStateDistribution() {
    const dist = {};
    for (const state of Object.values(ValidationState)) {
      dist[state] = 0;
    }
    for (const task of Object.values(this.state.tasks)) {
      dist[task.state]++;
    }
    return dist;
  }

  /**
   * 清理过期任务
   */
  cleanupExpired() {
    if (!this.config.cleanup.autoCleanup) {
      return;
    }

    const now = Date.now();
    const maxAge = this.config.cleanup.maxAge;
    let cleaned = 0;

    for (const [id, task] of Object.entries(this.state.tasks)) {
      if (now - task.updatedAt > maxAge) {
        delete this.state.tasks[id];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[StateManager] Cleaned up ${cleaned} expired tasks`);
      this._saveState();
    }

    return cleaned;
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  healthCheck() {
    return {
      status: 'healthy',
      uptime: process.uptime(),
      stats: this.getStats(),
      tasksCount: Object.keys(this.state.tasks).length
    };
  }
}

// 导出单例实例和枚举
const stateManager = new StateManager();

module.exports = {
  stateManager,
  StateManager,
  ValidationState,
  STATE_TRANSITIONS
};
