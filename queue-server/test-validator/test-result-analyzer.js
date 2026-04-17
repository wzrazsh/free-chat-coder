const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const REPORT_DIR = path.join(WORKSPACE_ROOT, 'queue-server', 'data', 'test-reports');

const DECISION = {
  PASS: 'pass',
  REVIEW: 'review',
  FAIL: 'fail'
};

function sanitizeFilename(value) {
  return String(value || 'validation').replace(/[^a-zA-Z0-9._-]/g, '_');
}

class TestResultAnalyzer {
  constructor() {
    this.results = [];
  }

  clear() {
    this.results = [];
  }

  addResult(result) {
    if (result) {
      this.results.push(result);
    }
  }

  addResults(results = []) {
    for (const result of results) {
      this.addResult(result);
    }
  }

  analyze(context = {}) {
    const checks = this.results.map((result) => (
      typeof result.toJSON === 'function' ? result.toJSON() : result
    ));
    const passedChecks = checks.filter((check) => check.status === 'passed');
    const failedChecks = checks.filter((check) => check.status === 'failed' || check.status === 'error');
    const skippedChecks = checks.filter((check) => check.status === 'skipped');
    const success = failedChecks.length === 0;

    return {
      context,
      summary: {
        total: checks.length,
        passed: passedChecks.length,
        failed: failedChecks.length,
        skipped: skippedChecks.length,
        success
      },
      decision: {
        action: success ? DECISION.PASS : DECISION.FAIL,
        reason: success
          ? 'All validation checks passed'
          : `${failedChecks.length} validation check(s) failed`
      },
      confidence: {
        score: success
          ? 1
          : Math.max(0, 1 - (failedChecks.length / Math.max(checks.length, 1)))
      },
      recommendations: failedChecks.map((check) => (
        `Review ${check.targetPath || check.name || 'validation output'}: ${check.error || check.details?.reason || 'validation failed'}`
      )),
      checks,
      passedChecks,
      failedChecks,
      skippedChecks
    };
  }
}

const TestReportGenerator = {
  generateAndSave(analysis, metadata = {}) {
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    const evolutionId = sanitizeFilename(metadata.evolutionId || `validation-${Date.now()}`);
    const reportPath = path.join(REPORT_DIR, `${evolutionId}.validation.json`);
    const payload = {
      createdAt: new Date().toISOString(),
      metadata,
      analysis
    };

    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
    return reportPath;
  }
};

module.exports = {
  DECISION,
  TestReportGenerator,
  TestResultAnalyzer
};
