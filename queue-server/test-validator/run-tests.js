/**
 * 统一测试运行脚本
 * 运行当前 test-validator 相关的回归脚本并生成报告
 */

const fs = require('fs');
const path = require('path');

process.env.WORKSPACE_ROOT = path.resolve(__dirname, '../..');

async function runTests() {
  console.log('=== Test Validator Regression Suite ===\n');
  console.log('Workspace root:', process.env.WORKSPACE_ROOT);

  try {
    const testValidator = require('./index.js');

    console.log('\nLoaded modules:');
    console.log('- testValidatorService:', testValidator.testValidatorService ? 'OK' : 'MISSING');
    console.log('- validationService:', testValidator.validationService ? 'OK' : 'MISSING');
    console.log('- rollbackManager:', testValidator.rollbackManager ? 'OK' : 'MISSING');
    console.log('- unifiedTestRunner:', testValidator.unifiedTestRunner ? 'OK' : 'MISSING');

    console.log('\nRunning suites...\n');
    const result = await testValidator.testValidatorService.runUnifiedTestSuite({
      skipServerCheck: false
    });

    console.log('\n=== Summary ===');
    console.log(JSON.stringify(result.summary, null, 2));

    const reportPath = path.join(__dirname, '../data/test-reports/unified-test-report.json');
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`\nReport written: ${reportPath}`);

    if (result.summary.failed === 0 && result.summary.errors === 0) {
      console.log('\nPASS');
      process.exit(0);
    }

    console.log('\nFAIL');
    process.exit(1);
  } catch (error) {
    console.error('\nTest run failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
