const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { testExecutor, TEST_CONFIG } = require('./test-executor');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');

const P0_CONFIG = {
  priority: 'P0',
  timeout: TEST_CONFIG.timeout
};

function uniqueChecks(checks) {
  const seen = new Set();

  return checks.filter((check) => {
    const key = `${check.type}:${check.targetPath || check.filePath || check.name || ''}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildFileChecks(targetPath) {
  if (!targetPath) {
    return [];
  }

  return [
    { type: 'node_syntax', targetPath },
    { type: 'content_guard', targetPath }
  ];
}

function buildActionChecks(action, targetPath) {
  const checks = [...buildFileChecks(targetPath)];

  if (action === 'evolve_handler' || action === 'evolve_server') {
    checks.push({
      type: 'node_syntax',
      targetPath: path.join(WORKSPACE_ROOT, 'queue-server', 'index.js')
    });
  }

  return uniqueChecks(checks);
}

function buildDefaultP0Checks() {
  const defaultTargets = [
    path.join(WORKSPACE_ROOT, 'queue-server', 'index.js'),
    path.join(WORKSPACE_ROOT, 'queue-server', 'custom-handler.js'),
    path.join(WORKSPACE_ROOT, 'chromevideo', 'background.js'),
    path.join(WORKSPACE_ROOT, 'chromevideo', 'offscreen.js'),
    path.join(WORKSPACE_ROOT, 'chromevideo', 'sidepanel.js')
  ];

  return uniqueChecks(defaultTargets.flatMap((targetPath) => buildFileChecks(targetPath)));
}

class P0TestExecutor extends EventEmitter {
  constructor() {
    super();
    this.results = [];
  }

  async runRelatedTests(action, options = {}) {
    const checks = buildActionChecks(action, options.targetPath);
    return await this._runChecks(checks, options);
  }

  async runAllP0Tests(options = {}) {
    return await this._runChecks(buildDefaultP0Checks(), options);
  }

  async runTest(testFile, options = {}) {
    this.emit('test:start', {
      type: 'script',
      testFile
    });

    const result = await testExecutor.runTestScript(testFile, options);
    this.results = [result];
    this.emit('test:complete', result);

    return result;
  }

  getPassRate() {
    if (!this.results || this.results.length === 0) {
      return null;
    }

    const passed = this.results.filter((result) => result.status === 'passed').length;
    return passed / this.results.length;
  }

  async _runChecks(checks, options = {}) {
    const effectiveChecks = checks.filter((check) => (
      check.filePath ? fs.existsSync(check.filePath) : true
    ));

    const results = [];
    for (let index = 0; index < effectiveChecks.length; index += 1) {
      const check = effectiveChecks[index];
      this.emit('test:start', {
        check,
        index,
        total: effectiveChecks.length
      });

      const result = await testExecutor.runCheck(check, options);
      results.push(result);
      this.emit('test:progress', {
        check,
        index: index + 1,
        total: effectiveChecks.length,
        result
      });
      this.emit('test:complete', result);

      if (!options.continueOnFailure && (result.status === 'failed' || result.status === 'error')) {
        break;
      }
    }

    this.results = results;
    return results;
  }
}

const p0TestExecutor = new P0TestExecutor();

module.exports = {
  p0TestExecutor,
  P0TestExecutor,
  P0_CONFIG,
  buildActionChecks,
  buildDefaultP0Checks
};
