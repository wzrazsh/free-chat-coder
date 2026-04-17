/**
 * 测试验证服务入口
 * 导出测试验证服务的主要接口，包含健康检查、初始化功能
 */

const { eventBus, TestValidatorEventBus, EVENTS } = require('./event-bus');
const { stateManager, StateManager, ValidationState } = require('./state-manager');
const { communicator, Communicator, MESSAGE_TYPES, VALIDATION_PRIORITY } = require('./communicator');
const { testExecutor, TestExecutor, TEST_CONFIG } = require('./test-executor');

// 导入新增的组件
let validationService = null;
let rollbackManager = null;
let unifiedTestRunner = null;

/**
 * 动态导入新增组件（避免依赖问题）
 */
function loadExtendedComponents() {
  if (!validationService) {
    try {
      const validationModule = require('./validation-service');
      validationService = validationModule.validationService;
    } catch (e) {
      console.warn('[TestValidatorService] Extended validation service not available:', e.message);
    }
  }

  if (!rollbackManager) {
    try {
      const rollbackModule = require('./rollback-manager');
      rollbackManager = rollbackModule.rollbackManager;
    } catch (e) {
      console.warn('[TestValidatorService] Rollback manager not available:', e.message);
    }
  }

  if (!unifiedTestRunner) {
    try {
      const runnerModule = require('./unified-test-runner');
      unifiedTestRunner = runnerModule.unifiedTestRunner;
    } catch (e) {
      console.warn('[TestValidatorService] Unified test runner not available:', e.message);
    }
  }
}

/**
 * 测试验证服务类
 * 提供统一的测试验证服务接口
 */
class TestValidatorService {
  constructor() {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
    this.communicator = communicator;
    this.testExecutor = testExecutor;
    this._initialized = false;

    // 加载扩展组件
    loadExtendedComponents();
  }

  /**
   * 初始化服务
   * @param {Object} options - 初始化选项
   */
  initialize(options = {}) {
    if (this._initialized) {
      console.log('[TestValidatorService] Already initialized');
      return;
    }

    console.log('[TestValidatorService] Initializing...');

    // 注册默认事件处理器
    this._registerDefaultHandlers();

    // 设置健康检查定时器
    if (options.healthCheckInterval) {
      this._startHealthCheck(options.healthCheckInterval);
    }

    // 设置状态清理
    if (options.autoCleanup !== false) {
      this._startStateCleanup(options.cleanupInterval || 3600000);
    }

    this._initialized = true;
    console.log('[TestValidatorService] Initialized successfully');
  }

  /**
   * 注册默认事件处理器
   * @private
   */
  _registerDefaultHandlers() {
    // 日志记录所有事件（可配置级别）
    const logEvents = [
      EVENTS.VALIDATION_START,
      EVENTS.VALIDATION_COMPLETE,
      EVENTS.VALIDATION_FAILED,
      EVENTS.DECISION_COMPLETE,
      EVENTS.DEPLOY_ROLLBACK
    ];

    for (const event of logEvents) {
      this.eventBus.on(event, (data) => {
        console.log(`[Event] ${event}:`, JSON.stringify(data, null, 2));
      });
    }
  }

  /**
   * 启动健康检查定时器
   * @private
   */
  _startHealthCheck(interval) {
    setInterval(() => {
      const health = this.getHealth();
      if (health.status !== 'healthy') {
        console.warn('[TestValidatorService] Health check warning:', health);
      }
    }, interval);
  }

  /**
   * 启动状态清理
   * @private
   */
  _startStateCleanup(interval) {
    setInterval(() => {
      const cleaned = this.stateManager.cleanupExpired();
      if (cleaned > 0) {
        console.log(`[TestValidatorService] Cleaned up ${cleaned} expired tasks`);
      }
    }, interval);
  }

  /**
   * 创建验证任务
   * @param {string} fixId - 修复ID
   * @param {Object} options - 验证选项
   * @returns {Promise<Object>} 验证任务信息
   */
  async createValidation(fixId, options = {}) {
    const validationId = `val_${fixId}_${Date.now()}`;

    const request = {
      validationId,
      fixId,
      errorType: options.errorType || 'unknown',
      codeChanges: options.codeChanges || {},
      files: options.files || [],
      priority: options.priority || VALIDATION_PRIORITY.P2_NORMAL,
      metadata: {
        source: 'test-validator-service',
        ...options.metadata
      }
    };

    return await this.communicator.sendValidationRequest(request);
  }

  /**
   * 查询验证状态
   * @param {string} validationId - 验证ID
   * @returns {Object} 验证状态
   */
  getValidationStatus(validationId) {
    return this.communicator.queryValidationStatus(validationId);
  }

  /**
   * 获取验证结果
   * @param {string} validationId - 验证ID
   * @returns {Object|null} 验证结果
   */
  getValidationResult(validationId) {
    const task = this.stateManager.getTask(validationId);
    return task ? task.result : null;
  }

  /**
   * 取消验证
   * @param {string} validationId - 验证ID
   * @returns {boolean} 是否成功
   */
  cancelValidation(validationId) {
    return this.communicator.cancelValidation(validationId);
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      stateManager: this.stateManager.getStats(),
      eventBus: this.eventBus.getMetrics(),
      testExecutor: this.testExecutor.getHealth()
    };
  }

  /**
   * 运行 P0 测试
   * @param {Object} options - 测试选项
   * @returns {Promise<Object>} 测试结果
   */
  async runP0Tests(options = {}) {
    console.log('[TestValidatorService] Running P0 tests...');
    this.eventBus.emit(EVENTS.TEST_START, { options });

    try {
      const result = await this.testExecutor.runP0Tests(options);
      this.eventBus.emit(EVENTS.TEST_COMPLETE, { result });
      return result;
    } catch (error) {
      this.eventBus.emit(EVENTS.TEST_ERROR, { error: error.message });
      throw error;
    }
  }

  /**
   * 运行统一测试套件 (US-001 到 US-004)
   * @param {Object} options - 运行选项
   * @returns {Promise<Object>} 测试结果
   */
  async runUnifiedTestSuite(options = {}) {
    loadExtendedComponents();

    if (!unifiedTestRunner) {
      throw new Error('Unified test runner not available');
    }

    console.log('[TestValidatorService] Running unified test suite (US-001 to US-004)...');

    const results = await unifiedTestRunner.runAllSuites(options);
    const summary = unifiedTestRunner.getSummary();

    return {
      results: results.map(r => r.toJSON()),
      summary
    };
  }

  /**
   * 执行扩展验证流程（包含自动回滚）
   * @param {Object} params - 验证参数
   * @returns {Promise<Object>}
   */
  async runExtendedValidation(params) {
    loadExtendedComponents();

    if (!validationService) {
      throw new Error('Extended validation service not available');
    }

    return await validationService.validate(params);
  }

  /**
   * 触发回滚
   * @param {string} evolutionId - 进化ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async triggerRollback(evolutionId, options = {}) {
    loadExtendedComponents();

    if (!rollbackManager) {
      throw new Error('Rollback manager not available');
    }

    return await rollbackManager.rollback(evolutionId, options);
  }

  /**
   * 运行语法检查
   * @param {string} targetPath - 目标路径
   * @returns {Promise<Object>} 检查结果
   */
  async runSyntaxCheck(targetPath = null) {
    return await this.testExecutor.runSyntaxCheck(targetPath);
  }

  /**
   * 运行安全扫描
   * @param {string} targetPath - 目标路径
   * @returns {Promise<Object>} 扫描结果
   */
  async runSecurityScan(targetPath = null) {
    return await this.testExecutor.runSecurityScan(targetPath);
  }

  /**
   * 健康检查
   * @returns {Object} 健康状态
   */
  getHealth() {
    const health = {
      status: 'healthy',
      initialized: this._initialized,
      components: {
        eventBus: this.eventBus.healthCheck(),
        stateManager: this.stateManager.healthCheck(),
        communicator: this.communicator.healthCheck(),
        testExecutor: this.testExecutor.getHealth()
      },
      uptime: process.uptime(),
      timestamp: Date.now()
    };

    // 添加扩展组件健康状态
    loadExtendedComponents();
    if (validationService) {
      try {
        health.components.extendedValidation = validationService.getHealthStatus();
      } catch (e) {
        health.components.extendedValidation = { status: 'unavailable', error: e.message };
      }
    }

    return health;
  }

  /**
   * 获取所有活动验证
   * @returns {Array} 活动验证列表
   */
  getActiveValidations() {
    return this.stateManager.getAllTasks({ active: true });
  }
}

// 导出单例实例
const testValidatorService = new TestValidatorService();

module.exports = {
  // 导出服务实例
  testValidatorService,
  TestValidatorService,

  // 导出子模块
  eventBus,
  stateManager,
  communicator,
  testExecutor,

  // 导出扩展组件（动态加载）
  get validationService() { loadExtendedComponents(); return validationService; },
  get rollbackManager() { loadExtendedComponents(); return rollbackManager; },
  get unifiedTestRunner() { loadExtendedComponents(); return unifiedTestRunner; },

  // 导出常量
  EVENTS,
  ValidationState,
  MESSAGE_TYPES,
  VALIDATION_PRIORITY,

  // 导出工具类
  TestValidatorEventBus,
  StateManager,
  TestExecutor,
  TEST_CONFIG
};
