/**
 * 测试验证事件总线
 * 基于 Node.js EventEmitter，支持异步事件处理和测试生命周期事件
 */

const { EventEmitter } = require('events');

/**
 * 事件名称定义
 */
const EVENTS = {
  // 测试生命周期事件
  TEST_START: 'test:start',
  TEST_PROGRESS: 'test:progress',
  TEST_COMPLETE: 'test:complete',
  TEST_ERROR: 'test:error',
  TEST_TIMEOUT: 'test:timeout',

  // 验证任务事件
  VALIDATION_START: 'validation:start',
  VALIDATION_PROGRESS: 'validation:progress',
  VALIDATION_COMPLETE: 'validation:complete',
  VALIDATION_FAILED: 'validation:failed',

  // 决策事件
  DECISION_START: 'decision:start',
  DECISION_COMPLETE: 'decision:complete',
  DECISION_REVIEW: 'decision:review',  // 需要人工审查

  // 部署事件
  DEPLOY_START: 'deploy:start',
  DEPLOY_COMPLETE: 'deploy:complete',
  DEPLOY_ROLLBACK: 'deploy:rollback',

  // 系统事件
  HEALTH_CHECK: 'health:check',
  HEALTH_STATUS: 'health:status',
  SERVICE_ERROR: 'service:error'
};

/**
 * 测试验证事件总线类
 * 继承自 EventEmitter，支持异步事件处理和错误传播
 */
class TestValidatorEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);  // 允许更多监听器
    this._eventQueue = [];     // 异步事件队列
    this._processing = false;
    this._metrics = {
      eventsProcessed: 0,
      eventsFailed: 0,
      lastEventTime: null
    };

    // 错误处理
    this.on('error', (error) => {
      console.error('[EventBus] Unhandled error:', error.message);
      this._metrics.eventsFailed++;
    });
  }

  /**
   * 发射事件（异步处理）
   * @param {string} eventName - 事件名称
   * @param {Object} data - 事件数据
   */
  emitAsync(eventName, data) {
    this._eventQueue.push({ eventName, data, timestamp: Date.now() });
    this._processQueue();
  }

  /**
   * 处理事件队列
   * @private
   */
  async _processQueue() {
    if (this._processing || this._eventQueue.length === 0) {
      return;
    }

    this._processing = true;

    while (this._eventQueue.length > 0) {
      const { eventName, data, timestamp } = this._eventQueue.shift();

      try {
        // 使用同步方式发射事件，确保监听器按注册顺序执行
        this.emit(eventName, data);

        this._metrics.eventsProcessed++;
        this._metrics.lastEventTime = timestamp;
      } catch (error) {
        console.error(`[EventBus] Error processing event ${eventName}:`, error.message);
        this._metrics.eventsFailed++;

        // 发射错误事件
        this.emit(EVENTS.SERVICE_ERROR, {
          originalEvent: eventName,
          error: error.message,
          timestamp
        });
      }
    }

    this._processing = false;
  }

  /**
   * 发射带确认的事件
   * @param {string} eventName - 事件名称
   * @param {Object} data - 事件数据
   * @returns {Promise<Object>} 事件处理结果
   */
  async emitWithAck(eventName, data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Event ${eventName} timed out`));
      }, 5000);

      this.emit(eventName, {
        ...data,
        ack: (result) => {
          clearTimeout(timeout);
          resolve(result);
        }
      });
    });
  }

  /**
   * 获取事件指标
   * @returns {Object} 事件处理指标
   */
  getMetrics() {
    return {
      ...this._metrics,
      queueLength: this._eventQueue.length,
      isProcessing: this._processing
    };
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  healthCheck() {
    return {
      status: 'healthy',
      uptime: process.uptime(),
      metrics: this.getMetrics(),
      listeners: this.listenerCount('*')
    };
  }
}

// 导出单例实例和事件常量
const eventBus = new TestValidatorEventBus();

module.exports = {
  eventBus,
  TestValidatorEventBus,
  EVENTS
};
