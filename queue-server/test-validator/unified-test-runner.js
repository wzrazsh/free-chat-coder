/**
 * 统一测试运行器
 * 运行当前仓库真实存在的验证脚本，并允许将较重的 E2E 套件按条件跳过
 */

const path = require('path');
const { discoverQueueServer } = require('../../shared/queue-server');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');

const TEST_SUITES = {
  'VAL-001': {
    id: 'VAL-001',
    name: 'Evolution validation guardrails',
    testFile: path.join(WORKSPACE_ROOT, 'test-evolution-validation.js'),
    description: '验证进化前最小校验、失败回滚和最近结果审计',
    priority: 'P0'
  }
};

class UnifiedTestResult {
  constructor(suiteId, status, duration, details = {}) {
    this.suiteId = suiteId;
    this.suiteName = TEST_SUITES[suiteId]?.name || suiteId;
    this.status = status;
    this.duration = duration;
    this.timestamp = new Date().toISOString();
    this.details = details;
    this.priority = TEST_SUITES[suiteId]?.priority || 'P1';
  }

  toJSON() {
    return {
      suiteId: this.suiteId,
      suiteName: this.suiteName,
      status: this.status,
      duration: this.duration,
      timestamp: this.timestamp,
      priority: this.priority,
      details: this.details
    };
  }

  static fromExistingResult(suiteId, result) {
    return new UnifiedTestResult(
      suiteId,
      result.status,
      result.duration,
      result.details || {}
    );
  }
}

class UnifiedTestRunner {
  constructor() {
    this.results = new Map();
    this.serverRunning = false;
  }

  async checkServerRunning() {
    try {
      const queueServer = await discoverQueueServer({ timeoutMs: 1200 });
      return !!queueServer;
    } catch (error) {
      return false;
    }
  }

  async runSuite(suiteId, options = {}) {
    const suite = TEST_SUITES[suiteId];
    if (!suite) {
      return new UnifiedTestResult(suiteId, 'error', 0, {
        error: `Unknown test suite: ${suiteId}`
      });
    }

    if (suite.requiresServer && !options.skipServerCheck) {
      this.serverRunning = await this.checkServerRunning();
      if (!this.serverRunning && !options.forceRun) {
        return new UnifiedTestResult(suiteId, 'skipped', 0, {
          reason: 'Server not running, skipping test that requires server',
          suggestion: 'Start the queue-server with `node queue-server/index.js`'
        });
      }
    }

    const { p0TestExecutor } = require('./test-runner');
    const startTime = Date.now();

    try {
      const result = await p0TestExecutor.runTest(suite.testFile, {
        timeout: options.timeout || 30000
      });

      const unifiedResult = UnifiedTestResult.fromExistingResult(suiteId, result);
      unifiedResult.duration = Date.now() - startTime;
      this.results.set(suiteId, unifiedResult);
      return unifiedResult;
    } catch (error) {
      const unifiedResult = new UnifiedTestResult(suiteId, 'error', Date.now() - startTime, {
        error: error.message,
        stack: error.stack
      });
      this.results.set(suiteId, unifiedResult);
      return unifiedResult;
    }
  }

  async runAllSuites(options = {}) {
    const results = [];
    for (const suiteId of Object.keys(TEST_SUITES)) {
      console.log(`\n=== Running ${suiteId}: ${TEST_SUITES[suiteId].name} ===`);
      const result = await this.runSuite(suiteId, options);
      results.push(result);
      console.log(`Result: ${result.status} (${result.duration}ms)`);
      if (result.details.error) {
        console.log(`Error: ${result.details.error}`);
      }
    }

    return results;
  }

  getResults() {
    return Array.from(this.results.values());
  }

  getSummary() {
    const results = this.getResults();
    const total = results.length;
    const passed = results.filter((result) => result.status === 'passed').length;
    const failed = results.filter((result) => result.status === 'failed').length;
    const skipped = results.filter((result) => result.status === 'skipped').length;
    const errors = results.filter((result) => result.status === 'error').length;

    return {
      total,
      passed,
      failed,
      skipped,
      errors,
      success: failed === 0 && errors === 0,
      results: results.map((result) => result.toJSON())
    };
  }
}

const unifiedTestRunner = new UnifiedTestRunner();

module.exports = {
  TEST_SUITES,
  UnifiedTestResult,
  UnifiedTestRunner,
  unifiedTestRunner
};
