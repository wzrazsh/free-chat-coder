/**
 * 测试验证通信接口
 * 定义与进化执行器的通信协议，处理验证请求和结果回调
 */

const { eventBus, EVENTS } = require('./event-bus');
const { stateManager, ValidationState } = require('./state-manager');

/**
 * 通信协议消息类型
 */
const MESSAGE_TYPES = {
  // 请求消息
  VALIDATION_REQUEST: 'validation:request',      // 验证请求
  VALIDATION_CANCEL: 'validation:cancel',        // 取消验证
  VALIDATION_STATUS: 'validation:status',        // 状态查询

  // 响应消息
  VALIDATION_RESULT: 'validation:result',          // 验证结果
  VALIDATION_PROGRESS: 'validation:progress',     // 进度更新
  VALIDATION_ERROR: 'validation:error',           // 验证错误

  // 决策消息
  DECISION_RESULT: 'decision:result',             // 决策结果
  DEPLOY_COMMAND: 'deploy:command',               // 部署命令
  ROLLBACK_COMMAND: 'rollback:command',          // 回滚命令

  // 系统消息
  HEALTH_CHECK: 'health:check',
  HEALTH_RESPONSE: 'health:response'
};

/**
 * 验证优先级
 */
const VALIDATION_PRIORITY = {
  P0_CRITICAL: 0,   // 关键修复，必须通过
  P1_HIGH: 1,       // 高优先级
  P2_NORMAL: 2,      // 普通优先级
  P3_LOW: 3         // 低优先级
};

/**
 * 验证请求结构
 * @typedef {Object} ValidationRequest
 * @property {string} validationId - 唯一验证ID
 * @property {string} fixId - 关联的修复ID
 * @property {string} errorType - 错误类型
 * @property {Object} codeChanges - 代码变更
 * @property {string[]} files - 涉及的文件列表
 * @property {number} priority - 优先级 (0-3)
 * @property {Object} metadata - 附加元数据
 */

/**
 * 验证结果结构
 * @typedef {Object} ValidationResult
 * @property {string} validationId - 唯一验证ID
 * @property {boolean} success - 是否成功
 * @property {string} state - 最终状态
 * @property {Object} testResults - 测试结果
 * @property {Object} decision - 决策结果
 * @property {number} confidence - 置信度 (0-1)
 * @property {string} recommendation - 建议 (deploy/rollback/review)
 */

/**
 * 通信接口类
 * 处理与进化执行器的双向通信
 */
class Communicator {
  constructor() {
    this._handlers = new Map();
    this._requestQueue = [];
    this._responseHandlers = new Map();
    this._setupDefaultHandlers();
  }

  /**
   * 设置默认事件处理器
   * @private
   */
  _setupDefaultHandlers() {
    // 监听测试完成事件
    eventBus.on(EVENTS.TEST_COMPLETE, (data) => {
      this._handleTestComplete(data);
    });

    // 监听验证完成事件
    eventBus.on(EVENTS.VALIDATION_COMPLETE, (data) => {
      this._handleValidationComplete(data);
    });

    // 监听验证失败事件
    eventBus.on(EVENTS.VALIDATION_FAILED, (data) => {
      this._handleValidationFailed(data);
    });

    // 监听决策完成事件
    eventBus.on(EVENTS.DECISION_COMPLETE, (data) => {
      this._handleDecisionComplete(data);
    });

    // 监听回滚事件
    eventBus.on(EVENTS.DEPLOY_ROLLBACK, (data) => {
      this._handleRollback(data);
    });
  }

  /**
   * 注册消息处理器
   * @param {string} messageType - 消息类型
   * @param {Function} handler - 处理函数
   */
  registerHandler(messageType, handler) {
    this._handlers.set(messageType, handler);
    console.log(`[Communicator] Registered handler for ${messageType}`);
  }

  /**
   * 发送验证请求
   * @param {ValidationRequest} request - 验证请求
   * @returns {Promise<Object>} 响应结果
   */
  async sendValidationRequest(request) {
    const { validationId, priority, ...rest } = request;

    // 验证请求格式
    if (!validationId) {
      throw new Error('validationId is required');
    }

    // 创建任务记录
    const task = stateManager.createTask(validationId, {
      ...rest,
      priority: priority || VALIDATION_PRIORITY.P2_NORMAL
    });

    // 转换到验证中状态
    stateManager.transitionTo(validationId, ValidationState.VALIDATING, {
      source: 'communicator:request'
    });

    // 发射验证开始事件
    eventBus.emit(EVENTS.VALIDATION_START, {
      validationId,
      task,
      priority
    });

    console.log(`[Communicator] Validation request sent: ${validationId}`);

    return {
      accepted: true,
      validationId,
      state: ValidationState.VALIDATING,
      message: 'Validation request accepted'
    };
  }

  /**
   * 查询验证状态
   * @param {string} validationId - 唯一验证ID
   * @returns {Object} 当前状态
   */
  queryValidationStatus(validationId) {
    const task = stateManager.getTask(validationId);

    if (!task) {
      return {
        found: false,
        message: `Validation ${validationId} not found`
      };
    }

    return {
      found: true,
      validationId,
      state: task.state,
      result: task.result,
      error: task.error,
      history: task.history,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  }

  /**
   * 发送验证结果
   * @param {ValidationResult} result - 验证结果
   * @returns {boolean} 是否成功
   */
  sendValidationResult(result) {
    const { validationId, success, state, testResults, decision, confidence, recommendation } = result;

    // 更新任务状态
    const targetState = success ? ValidationState.COMPLETED : ValidationState.FAILED;
    stateManager.transitionTo(validationId, targetState, {
      result: { testResults, decision, confidence, recommendation }
    });

    // 发射验证完成事件
    eventBus.emit(EVENTS.VALIDATION_COMPLETE, {
      validationId,
      success,
      state: targetState,
      result
    });

    console.log(`[Communicator] Validation result sent: ${validationId}, success=${success}`);

    return true;
  }

  /**
   * 发送进度更新
   * @param {string} validationId - 唯一验证ID
   * @param {Object} progress - 进度信息
   */
  sendProgressUpdate(validationId, progress) {
    eventBus.emit(EVENTS.VALIDATION_PROGRESS, {
      validationId,
      ...progress
    });

    // 同时更新任务历史
    const task = stateManager.getTask(validationId);
    if (task) {
      task.history.push({
        type: 'progress',
        timestamp: Date.now(),
        data: progress
      });
    }
  }

  /**
   * 发送取消请求
   * @param {string} validationId - 唯一验证ID
   * @returns {boolean} 是否成功
   */
  cancelValidation(validationId) {
    const task = stateManager.getTask(validationId);

    if (!task) {
      return false;
    }

    if (task.state === ValidationState.COMPLETED || task.state === ValidationState.FAILED) {
      console.log(`[Communicator] Cannot cancel completed/failed validation: ${validationId}`);
      return false;
    }

    stateManager.transitionTo(validationId, ValidationState.FAILED, {
      reason: 'cancelled'
    });

    eventBus.emit(EVENTS.VALIDATION_FAILED, {
      validationId,
      reason: 'cancelled'
    });

    console.log(`[Communicator] Validation cancelled: ${validationId}`);
    return true;
  }

  /**
   * 处理测试完成事件
   * @private
   */
  _handleTestComplete(data) {
    const { validationId, testResults } = data;
    console.log(`[Communicator] Test completed for: ${validationId}`);
    // 可以在这里添加与其他系统的集成逻辑
  }

  /**
   * 处理验证完成事件
   * @private
   */
  _handleValidationComplete(data) {
    const { validationId, result } = data;
    console.log(`[Communicator] Validation completed: ${validationId}`);
    // 可以在这里触发通知或其他系统集成
  }

  /**
   * 处理验证失败事件
   * @private
   */
  _handleValidationFailed(data) {
    const { validationId, reason } = data;
    console.log(`[Communicator] Validation failed: ${validationId}, reason: ${reason}`);
    // 可以在这里触发告警
  }

  /**
   * 处理决策完成事件
   * @private
   */
  _handleDecisionComplete(data) {
    const { validationId, decision } = data;
    console.log(`[Communicator] Decision completed: ${validationId}, decision: ${decision}`);
  }

  /**
   * 处理回滚事件
   * @private
   */
  _handleRollback(data) {
    const { validationId, reason } = data;
    console.log(`[Communicator] Rollback triggered: ${validationId}, reason: ${reason}`);
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  healthCheck() {
    return {
      status: 'healthy',
      uptime: process.uptime(),
      registeredHandlers: this._handlers.size,
      messageTypes: Object.values(MESSAGE_TYPES)
    };
  }
}

// 导出单例实例和常量
const communicator = new Communicator();

module.exports = {
  communicator,
  Communicator,
  MESSAGE_TYPES,
  VALIDATION_PRIORITY
};
