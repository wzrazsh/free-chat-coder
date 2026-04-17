/**
 * 统一测试运行器
 * 自动化执行 US-001 到 US-004 测试套件
 */

const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../..');

/**
 * 测试套件定义
 */
const TEST_SUITES = {
  'US-001': {
    id: 'US-001',
    name: '错误检测验证',
    testFile: path.join(WORKSPACE_ROOT, 'test-error-detection.js'),
    description: '验证 autoEvolveMonitor 错误检测功能',
    validUserStories: ['error-detection'],
    priority: 'P0'
  },
  'US-002': {
    id: 'US-002',
    name: 'WebSocket消息流转',
    testFile: path.join(WORKSPACE_ROOT, 'test-websocket-flow.js'),
    description: '验证从Chrome扩展到Queue-Server的auto_evolve消息完整链路',
    validUserStories: ['websocket-flow'],
    priority: 'P0',
    requiresServer: true
  },
  'US-003': {
    id: 'US-003',
    name: 'AI修复生成',
    testFile: path.join(WORKSPACE_ROOT, 'test-ai-repair-generation.js'),
    description: '验证 WebSocket handler 根据不同错误类型生成智能提示',
    validUserStories: ['ai-repair-generation'],
    priority: 'P0',
    requiresServer: true
  },
  'US-004': {
    id: 'US-004',
    name: '自动批准',
    testFile: path.join(WORKSPACE_ROOT, 'test-auto-approval.js'),
    description: '测试 confirm-manager 对进化动作的自动批准逻辑',
    validUserStories: ['auto-approval'],
    priority: 'P0',
    requiresServer: false
  },
  'US-005': {
    id: 'US-005',
    name: 'Playwright E2E测试',
    testFile: path.join(WORKSPACE_ROOT, 'test-playwright-e2e.js'),
    description: '使用 Playwright MCP 进行 Chrome 扩展端到端测试',
    validUserStories: ['playwright-e2e'],
    priority: 'P1',
    requiresServer: true,
    requiresBrowser: true
  }
};

/**
 * 统一测试结果格式
 */
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

/**
 * 统一测试运行器类
 */
class UnifiedTestRunner {
  constructor() {
    this.results = new Map();
    this.serverRunning = false;
  }

  /**
   * 检查服务器是否运行
   * @returns {Promise<boolean>}
   */
  async checkServerRunning() {
    return new Promise((resolve) => {
      try {
        const WebSocket = require('ws');
        const ws = new WebSocket('ws://localhost:8082', {
          timeout: 2000
        });

        ws.on('open', () => {
          ws.close();
          resolve(true);
        });

        ws.on('error', () => {
          resolve(false);
        });

        setTimeout(() => {
          ws.terminate();
          resolve(false);
        }, 2000);
      } catch (error) {
        resolve(false);
      }
    });
  }

  /**
   * 运行单个测试套件
   * @param {string} suiteId - 测试套件ID (US-001, US-002, etc.)
   * @param {Object} options - 运行选项
   * @returns {Promise<UnifiedTestResult>}
   */
  async runSuite(suiteId, options = {}) {
    const suite = TEST_SUITES[suiteId];
    if (!suite) {
      return new UnifiedTestResult(suiteId, 'error', 0, {
        error: `Unknown test suite: ${suiteId}`
      });
    }

    // 检查是否需要服务器
    if (suite.requiresServer && !options.skipServerCheck) {
      this.serverRunning = await this.checkServerRunning();
      if (!this.serverRunning && !options.forceRun) {
        return new UnifiedTestResult(suiteId, 'skipped', 0, {
          reason: 'Server not running, skipping test that requires server',
          suggestion: 'Start the queue-server with `node queue-server/index.js`'
        });
      }
    }

    // 动态导入测试执行器
    const testRunnerModule = require('./test-runner');
    const executor = testRunnerModule.p0TestExecutor;

    const startTime = Date.now();

    try {
      const results = await executor.runTest(suite.testFile, {
        timeout: options.timeout || 30000
      });

      const unifiedResult = UnifiedTestResult.fromExistingResult(suiteId, results);
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

  /**
   * 运行所有测试套件
   * @param {Object} options - 运行选项
   * @returns {Promise<Array<UnifiedTestResult>>}
   */
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

  /**
   * 运行指定测试套件
   * @param {Array<string>} suiteIds - 测试套件ID数组
   * @param {Object} options - 运行选项
   * @returns {Promise<Array<UnifiedTestResult>>}
   */
  async runSuites(suiteIds, options = {}) {
    const results = [];

    for (const suiteId of suiteIds) {
      if (!TEST_SUITES[suiteId]) {
        console.warn(`Unknown test suite: ${suiteId}`);
        continue;
      }

      console.log(`\n=== Running ${suiteId}: ${TEST_SUITES[suiteId].name} ===`);

      const result = await this.runSuite(suiteId, options);
      results.push(result);

      console.log(`Result: ${result.status} (${result.duration}ms)`);
    }

    return results;
  }

  /**
   * 根据功能标签运行测试
   * @param {string} tag - 功能标签
   * @param {Object} options - 运行选项
   * @returns {Promise<Array<UnifiedTestResult>>}
   */
  async runByTag(tag, options = {}) {
    const matchingSuites = Object.entries(TEST_SUITES)
      .filter(([_, suite]) => suite.validUserStories.includes(tag))
      .map(([id]) => id);

    if (matchingSuites.length === 0) {
      console.warn(`No test suites found for tag: ${tag}`);
      return [];
    }

    return await this.runSuites(matchingSuites, options);
  }

  /**
   * 获取所有结果
   * @returns {Array<UnifiedTestResult>}
   */
  getResults() {
    return Array.from(this.results.values());
  }

  /**
   * 获取汇总
   * @returns {Object}
   */
  getSummary() {
    const results = this.getResults();
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;

    return {
      total,
      passed,
      failed,
      skipped,
      errors,
      passRate: total > 0 ? (passed / total) * 100 : 0,
      results
    };
  }

  /**
   * 清除结果
   */
  clearResults() {
    this.results.clear();
  }
}

// 导出单例和类
const unifiedTestRunner = new UnifiedTestRunner();

module.exports = {
  unifiedTestRunner,
  UnifiedTestRunner,
  UnifiedTestResult,
  TEST_SUITES
};
