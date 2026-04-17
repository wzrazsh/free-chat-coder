const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');

const TEST_CONFIG = {
  timeout: 15000,
  placeholderPatterns: [
    { pattern: /```/, reason: 'Contains markdown code fence marker' },
    { pattern: /<ActionBlock>/i, reason: 'Contains unresolved action block marker' },
    { pattern: /manual merge/i, reason: 'Contains manual merge placeholder text' },
    { pattern: /TODO:\s*merge/i, reason: 'Contains unresolved merge TODO' },
    { pattern: /请在现有.*手动合并/, reason: 'Contains manual merge instructions in generated code' }
  ]
};

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.html',
  '.css',
  '.md'
]);

class ValidationCheckResult {
  constructor({
    name,
    status,
    duration,
    targetPath = null,
    command = null,
    stdout = '',
    stderr = '',
    error = null,
    details = null
  }) {
    this.name = name;
    this.status = status;
    this.duration = duration;
    this.targetPath = targetPath;
    this.command = command;
    this.stdout = stdout;
    this.stderr = stderr;
    this.error = error;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      duration: this.duration,
      targetPath: this.targetPath,
      command: this.command,
      stdout: this.stdout,
      stderr: this.stderr,
      error: this.error,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

function summarizeOutput(value = '') {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.length <= 4000) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4000)}\n... (truncated)`;
}

function isJavaScriptFile(targetPath) {
  return JAVASCRIPT_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

function isTextFile(targetPath) {
  return TEXT_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

class TestExecutor {
  constructor(config = {}) {
    this.config = {
      ...TEST_CONFIG,
      ...config
    };
    this.lastResults = [];
  }

  async runCheck(check, options = {}) {
    switch (check.type) {
      case 'node_syntax':
        return await this.runNodeSyntaxCheck(check.targetPath, options);
      case 'content_guard':
        return await this.runContentGuard(check.targetPath);
      case 'script':
        return await this.runTestScript(check.filePath, options);
      default:
        return new ValidationCheckResult({
          name: check.name || 'unknown_check',
          status: 'error',
          duration: 0,
          targetPath: check.targetPath || check.filePath || null,
          error: `Unknown validation check type: ${check.type}`
        });
    }
  }

  async runNodeSyntaxCheck(targetPath, options = {}) {
    const startTime = Date.now();

    if (!targetPath) {
      return new ValidationCheckResult({
        name: 'node_syntax',
        status: 'error',
        duration: Date.now() - startTime,
        error: 'targetPath is required'
      });
    }

    if (!fs.existsSync(targetPath)) {
      return new ValidationCheckResult({
        name: `syntax:${path.basename(targetPath)}`,
        status: 'failed',
        duration: Date.now() - startTime,
        targetPath,
        error: `File not found: ${targetPath}`
      });
    }

    if (!isJavaScriptFile(targetPath)) {
      return new ValidationCheckResult({
        name: `syntax:${path.basename(targetPath)}`,
        status: 'skipped',
        duration: Date.now() - startTime,
        targetPath,
        details: {
          reason: `Node syntax check only supports ${Array.from(JAVASCRIPT_EXTENSIONS).join(', ')}`
        }
      });
    }

    return await this._runProcess({
      name: `syntax:${path.basename(targetPath)}`,
      targetPath,
      command: process.execPath,
      args: ['-c', targetPath],
      timeout: options.timeout
    });
  }

  async runContentGuard(targetPath) {
    const startTime = Date.now();

    if (!targetPath) {
      return new ValidationCheckResult({
        name: 'content_guard',
        status: 'error',
        duration: Date.now() - startTime,
        error: 'targetPath is required'
      });
    }

    if (!fs.existsSync(targetPath)) {
      return new ValidationCheckResult({
        name: `content_guard:${path.basename(targetPath)}`,
        status: 'failed',
        duration: Date.now() - startTime,
        targetPath,
        error: `File not found: ${targetPath}`
      });
    }

    if (!isTextFile(targetPath)) {
      return new ValidationCheckResult({
        name: `content_guard:${path.basename(targetPath)}`,
        status: 'skipped',
        duration: Date.now() - startTime,
        targetPath,
        details: {
          reason: 'Content guard only scans known text file types'
        }
      });
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    for (const rule of this.config.placeholderPatterns) {
      if (rule.pattern.test(content)) {
        return new ValidationCheckResult({
          name: `content_guard:${path.basename(targetPath)}`,
          status: 'failed',
          duration: Date.now() - startTime,
          targetPath,
          error: rule.reason,
          details: {
            reason: rule.reason,
            pattern: rule.pattern.toString()
          }
        });
      }
    }

    return new ValidationCheckResult({
      name: `content_guard:${path.basename(targetPath)}`,
      status: 'passed',
      duration: Date.now() - startTime,
      targetPath,
      details: {
        checkedPatterns: this.config.placeholderPatterns.length
      }
    });
  }

  async runTestScript(filePath, options = {}) {
    const startTime = Date.now();

    if (!filePath) {
      return new ValidationCheckResult({
        name: 'script',
        status: 'error',
        duration: Date.now() - startTime,
        error: 'filePath is required'
      });
    }

    if (!fs.existsSync(filePath)) {
      return new ValidationCheckResult({
        name: `script:${path.basename(filePath)}`,
        status: 'failed',
        duration: Date.now() - startTime,
        targetPath: filePath,
        error: `Test file not found: ${filePath}`
      });
    }

    return await this._runProcess({
      name: `script:${path.basename(filePath)}`,
      targetPath: filePath,
      command: process.execPath,
      args: [filePath],
      timeout: options.timeout
    });
  }

  async runP0Tests(options = {}) {
    const checks = [];

    if (options.targetPath) {
      checks.push({ type: 'node_syntax', targetPath: options.targetPath });
      checks.push({ type: 'content_guard', targetPath: options.targetPath });
    }

    const results = [];
    for (const check of checks) {
      results.push(await this.runCheck(check, options));
    }

    this.lastResults = results;
    return this.summarizeResults(results);
  }

  async runSyntaxCheck(targetPath = null, options = {}) {
    if (targetPath) {
      const result = await this.runNodeSyntaxCheck(targetPath, options);
      return this.summarizeResults([result]);
    }

    const defaultTargets = [
      path.join(WORKSPACE_ROOT, 'queue-server', 'index.js'),
      path.join(WORKSPACE_ROOT, 'chromevideo', 'background.js'),
      path.join(WORKSPACE_ROOT, 'chromevideo', 'offscreen.js'),
      path.join(WORKSPACE_ROOT, 'chromevideo', 'sidepanel.js')
    ];

    const results = [];
    for (const filePath of defaultTargets) {
      results.push(await this.runNodeSyntaxCheck(filePath, options));
    }

    this.lastResults = results;
    return this.summarizeResults(results);
  }

  async runSecurityScan(targetPath = null) {
    if (targetPath) {
      const result = await this.runContentGuard(targetPath);
      return this.summarizeResults([result]);
    }

    return this.summarizeResults([
      new ValidationCheckResult({
        name: 'security_scan',
        status: 'skipped',
        duration: 0,
        details: {
          reason: 'No repository-wide security scanner configured yet'
        }
      })
    ]);
  }

  summarizeResults(results = []) {
    const normalized = results.map((result) => (
      typeof result.toJSON === 'function' ? result.toJSON() : result
    ));
    const failed = normalized.filter((result) => result.status === 'failed' || result.status === 'error');
    const passed = normalized.filter((result) => result.status === 'passed');
    const skipped = normalized.filter((result) => result.status === 'skipped');

    return {
      success: failed.length === 0,
      totals: {
        total: normalized.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length
      },
      results: normalized
    };
  }

  getHealth() {
    return {
      status: 'healthy',
      workspaceRoot: WORKSPACE_ROOT,
      lastRunCount: this.lastResults.length,
      placeholderPatterns: this.config.placeholderPatterns.length
    };
  }

  async _runProcess({ name, targetPath, command, args, timeout }) {
    const startTime = Date.now();
    const effectiveTimeout = timeout || this.config.timeout;

    return await new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: WORKSPACE_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, effectiveTimeout);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve(new ValidationCheckResult({
          name,
          status: 'error',
          duration: Date.now() - startTime,
          targetPath,
          command: [command, ...args].join(' '),
          stdout: summarizeOutput(stdout),
          stderr: summarizeOutput(stderr),
          error: error.message
        }));
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve(new ValidationCheckResult({
            name,
            status: 'failed',
            duration: Date.now() - startTime,
            targetPath,
            command: [command, ...args].join(' '),
            stdout: summarizeOutput(stdout),
            stderr: summarizeOutput(stderr),
            error: `Validation timed out after ${effectiveTimeout}ms`,
            details: {
              signal
            }
          }));
          return;
        }

        resolve(new ValidationCheckResult({
          name,
          status: code === 0 ? 'passed' : 'failed',
          duration: Date.now() - startTime,
          targetPath,
          command: [command, ...args].join(' '),
          stdout: summarizeOutput(stdout),
          stderr: summarizeOutput(stderr),
          error: code === 0 ? null : `Exited with code ${code}`
        }));
      });
    });
  }
}

const testExecutor = new TestExecutor();

module.exports = {
  TEST_CONFIG,
  TestExecutor,
  ValidationCheckResult,
  testExecutor
};
