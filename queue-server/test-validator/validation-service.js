/**
 * 测试验证服务 - 主服务入口
 * 集成最小 P0 验证、结果分析、回滚触发和最近一次进化审计持久化
 */

const fs = require('fs');
const path = require('path');
const { eventBus, EVENTS } = require('./event-bus');
const { p0TestExecutor, P0_CONFIG } = require('./test-runner');
const { TestResultAnalyzer, TestReportGenerator, DECISION } = require('./test-result-analyzer');
const { rollbackManager } = require('./rollback-manager');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const EVOLUTION_STATUS_FILE = path.join(WORKSPACE_ROOT, 'queue-server', 'data', 'evolution-validation-history.json');
const MAX_HISTORY = 20;

/**
 * 验证服务配置
 */
const VALIDATION_CONFIG = {
  p0MustPass: true,
  degradedMode: false,
  confidenceThreshold: {
    pass: 0.8,
    review: 0.5,
    fail: 0
  },
  rollback: {
    enabled: true,
    onP0Failure: true,
    onLowConfidence: false
  }
};

function ensureStatusDir() {
  const statusDir = path.dirname(EVOLUTION_STATUS_FILE);
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }
}

/**
 * 测试验证服务类
 */
class ValidationService {
  constructor() {
    this.analyzer = new TestResultAnalyzer();
    this.lastValidation = null;
    this.pendingValidations = new Map();
    this.evolutionStatusHistory = [];

    this._loadEvolutionStatusHistory();
    this.registerEventListeners();
  }

  /**
   * 注册事件监听器
   */
  registerEventListeners() {
    p0TestExecutor.on('test:start', (data) => {
      eventBus.emitAsync(EVENTS.TEST_START, data);
    });

    p0TestExecutor.on('test:progress', (data) => {
      eventBus.emitAsync(EVENTS.TEST_PROGRESS, data);
    });

    p0TestExecutor.on('test:complete', (result) => {
      this.analyzer.addResult(result);
      eventBus.emitAsync(EVENTS.TEST_COMPLETE, result);
    });
  }

  /**
   * 记录最近一次进化验证状态，并持久化到磁盘
   * @param {Object} status
   * @returns {Object}
   */
  recordEvolutionStatus(status) {
    const normalizedStatus = {
      ...status,
      recordedAt: status.recordedAt || new Date().toISOString()
    };

    this.evolutionStatusHistory = [
      normalizedStatus,
      ...this.evolutionStatusHistory.filter((item) => item.evolutionId !== normalizedStatus.evolutionId)
    ].slice(0, MAX_HISTORY);

    this._saveEvolutionStatusHistory();
    return normalizedStatus;
  }

  /**
   * 获取最近一次进化验证状态
   * @returns {Object|null}
   */
  getLatestEvolutionStatus() {
    return this.evolutionStatusHistory[0] || null;
  }

  /**
   * 获取最近的进化验证状态列表
   * @param {number} limit
   * @returns {Array}
   */
  getRecentEvolutionStatuses(limit = 10) {
    return this.evolutionStatusHistory.slice(0, limit);
  }

  /**
   * 执行P0测试验证
   * @param {Object} params - 验证参数
   * @returns {Promise<Object>}
   */
  async runP0Validation(params = {}) {
    const evolutionId = params.evolutionId || `val-${Date.now()}`;
    const action = params.action || 'evolve_extension';
    const riskLevel = params.riskLevel || 'low';
    const context = {
      evolutionId,
      action,
      riskLevel,
      targetPath: params.targetPath || null,
      phase: params.phase || 'post_change',
      historySuccessRate: params.historySuccessRate || 0.8
    };

    console.log(`[ValidationService] Starting ${context.phase} validation for: ${evolutionId}`);

    eventBus.emitAsync(EVENTS.VALIDATION_START, {
      evolutionId,
      priority: P0_CONFIG.priority,
      phase: context.phase,
      targetPath: context.targetPath
    });

    try {
      let testResults;

      if (params.testSpecific) {
        testResults = await p0TestExecutor.runRelatedTests(action, {
          timeout: P0_CONFIG.timeout,
          targetPath: params.targetPath,
          continueOnFailure: false
        });
      } else {
        testResults = await p0TestExecutor.runAllP0Tests({
          timeout: P0_CONFIG.timeout,
          quickOnly: VALIDATION_CONFIG.degradedMode,
          continueOnFailure: false
        });
      }

      this.analyzer.clear();
      this.analyzer.addResults(testResults);
      const analysis = this.analyzer.analyze(context);
      const reportPath = TestReportGenerator.generateAndSave(analysis, {
        evolutionId,
        phase: context.phase,
        priority: P0_CONFIG.priority,
        targetPath: context.targetPath
      });

      this.lastValidation = {
        evolutionId,
        timestamp: new Date().toISOString(),
        action,
        phase: context.phase,
        targetPath: context.targetPath,
        analysis,
        reportPath
      };

      if (analysis.decision.action === DECISION.FAIL) {
        eventBus.emitAsync(EVENTS.VALIDATION_FAILED, {
          evolutionId,
          analysis,
          phase: context.phase
        });
      } else {
        eventBus.emitAsync(EVENTS.VALIDATION_COMPLETE, {
          evolutionId,
          analysis,
          phase: context.phase
        });
      }

      return {
        success: analysis.decision.action !== DECISION.FAIL,
        evolutionId,
        action,
        phase: context.phase,
        targetPath: context.targetPath,
        analysis,
        testResults: testResults.map((result) => result.toJSON()),
        decision: analysis.decision,
        recommendations: analysis.recommendations,
        reportPath
      };
    } catch (error) {
      console.error('[ValidationService] Validation error:', error);

      eventBus.emit(EVENTS.SERVICE_ERROR, {
        evolutionId,
        error: error.message,
        phase: context.phase
      });

      return {
        success: false,
        evolutionId,
        action,
        phase: context.phase,
        targetPath: context.targetPath,
        error: error.message
      };
    }
  }

  /**
   * 验证并决定是否需要回滚
   * @param {Object} validationResult - 验证结果
   * @returns {Promise<Object>}
   */
  async validateAndRollback(validationResult) {
    if (!validationResult.success && VALIDATION_CONFIG.rollback.enabled) {
      const { evolutionId, analysis } = validationResult;

      if (!analysis || !analysis.decision) {
        return validationResult;
      }

      console.log('[ValidationService] Validation failed, checking rollback conditions...');

      const shouldRollback =
        (VALIDATION_CONFIG.rollback.onP0Failure && analysis.decision.action === DECISION.FAIL) ||
        (VALIDATION_CONFIG.rollback.onLowConfidence &&
          analysis.confidence.score < VALIDATION_CONFIG.confidenceThreshold.fail);

      if (shouldRollback) {
        console.log(`[ValidationService] Triggering rollback for: ${evolutionId}`);

        eventBus.emitAsync(EVENTS.DEPLOY_ROLLBACK, {
          evolutionId,
          reason: analysis.decision.reason
        });

        const rollbackResult = await rollbackManager.rollback(evolutionId);

        return {
          ...validationResult,
          rollbackTriggered: true,
          rollbackResult
        };
      }
    }

    return validationResult;
  }

  /**
   * 执行完整验证流程（包括自动回滚）
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async validate(params) {
    const validationResult = await this.runP0Validation(params);
    return await this.validateAndRollback(validationResult);
  }

  /**
   * 获取健康状态
   * @returns {Object}
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      uptime: process.uptime(),
      lastValidation: this.lastValidation,
      latestEvolutionStatus: this.getLatestEvolutionStatus(),
      eventBus: eventBus.healthCheck(),
      executorMetrics: p0TestExecutor.results ? p0TestExecutor.getPassRate() : null,
      rollbackRecords: rollbackManager.getAllRecords().slice(-10)
    };
  }

  _loadEvolutionStatusHistory() {
    ensureStatusDir();

    if (!fs.existsSync(EVOLUTION_STATUS_FILE)) {
      this.evolutionStatusHistory = [];
      return;
    }

    try {
      const data = fs.readFileSync(EVOLUTION_STATUS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      this.evolutionStatusHistory = Array.isArray(parsed.history) ? parsed.history : [];
    } catch (error) {
      console.warn('[ValidationService] Failed to load evolution validation history:', error.message);
      this.evolutionStatusHistory = [];
    }
  }

  _saveEvolutionStatusHistory() {
    ensureStatusDir();

    const payload = {
      updatedAt: new Date().toISOString(),
      history: this.evolutionStatusHistory
    };

    fs.writeFileSync(EVOLUTION_STATUS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  }
}

const validationService = new ValidationService();

module.exports = {
  validationService,
  ValidationService,
  VALIDATION_CONFIG,
  EVENTS
};
