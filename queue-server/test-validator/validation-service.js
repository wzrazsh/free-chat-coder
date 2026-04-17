/**
 * 测试验证服务 - 主服务入口
 * 集成测试执行、结果分析和回滚机制
 */

const { eventBus, EVENTS } = require('./event-bus');
const { p0TestExecutor, P0_CONFIG } = require('./test-runner');
const { TestResultAnalyzer, TestReportGenerator, DECISION } = require('./test-result-analyzer');
const { rollbackManager } = require('./rollback-manager');

/**
 * 验证服务配置
 */
const VALIDATION_CONFIG = {
  // P0测试必须通过
  p0MustPass: true,

  // 降级模式下只运行快速测试
  degradedMode: false,

  // 决策置信度阈值
  confidenceThreshold: {
    pass: 0.8,
    review: 0.5,
    fail: 0
  },

  // 回滚配置
  rollback: {
    enabled: true,
    onP0Failure: true,
    onLowConfidence: false
  }
};

/**
 * 测试验证服务类
 */
class ValidationService {
  constructor() {
    this.analyzer = new TestResultAnalyzer();
    this.lastValidation = null;
    this.pendingValidations = new Map();

    // 注册事件监听
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
      historySuccessRate: params.historySuccessRate || 0.8
    };

    console.log(`[ValidationService] Starting P0 validation for: ${evolutionId}`);

    eventBus.emitAsync(EVENTS.VALIDATION_START, {
      evolutionId,
      priority: P0_CONFIG.priority
    });

    try {
      // 执行测试
      let testResults;

      if (params.testSpecific) {
        // 运行特定测试
        testResults = await p0TestExecutor.runRelatedTests(action, {
          timeout: P0_CONFIG.timeout
        });
      } else {
        // 运行所有P0测试
        testResults = await p0TestExecutor.runAllP0Tests({
          timeout: P0_CONFIG.timeout,
          quickOnly: VALIDATION_CONFIG.degradedMode
        });
      }

      // 分析结果
      this.analyzer.clear();
      this.analyzer.addResults(testResults);
      const analysis = this.analyzer.analyze(context);

      // 记录验证结果
      this.lastValidation = {
        evolutionId,
        timestamp: new Date().toISOString(),
        analysis
      };

      // 发射验证完成事件
      if (analysis.decision.action === DECISION.FAIL) {
        eventBus.emitAsync(EVENTS.VALIDATION_FAILED, {
          evolutionId,
          analysis
        });
      } else {
        eventBus.emitAsync(EVENTS.VALIDATION_COMPLETE, {
          evolutionId,
          analysis
        });
      }

      return {
        success: analysis.decision.action !== DECISION.FAIL,
        evolutionId,
        analysis,
        testResults: testResults.map(r => r.toJSON()),
        decision: analysis.decision,
        recommendations: analysis.recommendations
      };

    } catch (error) {
      console.error(`[ValidationService] Validation error:`, error);

      eventBus.emit(EVENTS.SERVICE_ERROR, {
        evolutionId,
        error: error.message
      });

      return {
        success: false,
        evolutionId,
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

      console.log(`[ValidationService] Validation failed, checking rollback conditions...`);

      const shouldRollback =
        (VALIDATION_CONFIG.rollback.onP0Failure && analysis.decision.action === DECISION.FAIL) ||
        (VALIDATION_CONFIG.rollback.onLowConfidence && analysis.confidence.score < VALIDATION_CONFIG.confidenceThreshold.fail);

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
    // 1. 运行P0测试验证
    const validationResult = await this.runP0Validation(params);

    // 2. 如果失败，检查是否需要回滚
    const finalResult = await this.validateAndRollback(validationResult);

    // 3. 生成报告
    if (finalResult.analysis) {
      finalResult.reportPath = TestReportGenerator.generateAndSave(finalResult.analysis, {
        evolutionId: finalResult.evolutionId,
        priority: P0_CONFIG.priority
      });
    }

    return finalResult;
  }

  /**
   * 生成测试报告
   * @param {Object} params
   * @returns {string}
   */
  generateReport(params = {}) {
    if (!this.lastValidation) {
      return null;
    }

    return TestReportGenerator.generateAndSave(this.lastValidation.analysis, {
      evolutionId: this.lastValidation.evolutionId,
      ...params
    });
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
      eventBus: eventBus.healthCheck(),
      executorMetrics: p0TestExecutor.results ? p0TestExecutor.getPassRate() : null,
      rollbackRecords: rollbackManager.getAllRecords().slice(-10)
    };
  }
}

// 导出单例实例
const validationService = new ValidationService();

module.exports = {
  validationService,
  ValidationService,
  VALIDATION_CONFIG,
  EVENTS
};
