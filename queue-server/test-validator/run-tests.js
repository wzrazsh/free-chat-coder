/**
 * 统一测试运行脚本
 * 运行 US-001 到 US-004 测试套件并生成报告
 */

const path = require('path');

// 设置工作目录
process.env.WORKSPACE_ROOT = path.resolve(__dirname, '../..');

async function runTests() {
  console.log('=== 统一测试套件运行 ===\n');
  console.log('工作目录:', process.env.WORKSPACE_ROOT);

  try {
    // 导入测试验证服务
    const testValidator = require('./index.js');

    console.log('\n已加载模块:');
    console.log('- testValidatorService:', testValidator.testValidatorService ? 'OK' : 'MISSING');
    console.log('- validationService:', testValidator.validationService ? 'OK' : 'MISSING');
    console.log('- rollbackManager:', testValidator.rollbackManager ? 'OK' : 'MISSING');
    console.log('- unifiedTestRunner:', testValidator.unifiedTestRunner ? 'OK' : 'MISSING');

    // 运行统一测试套件
    console.log('\n开始运行测试套件...\n');

    const result = await testValidator.testValidatorService.runUnifiedTestSuite({
      skipServerCheck: false
    });

    console.log('\n=== 测试结果 ===');
    console.log(JSON.stringify(result.summary, null, 2));

    // 保存结果
    const fs = require('fs');
    const reportPath = path.join(__dirname, '../data/test-reports/unified-test-report.json');
    const reportDir = path.dirname(reportPath);

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(`\n报告已保存: ${reportPath}`);

    // 返回结果
    if (result.summary.failed === 0 && result.summary.errors === 0) {
      console.log('\n✅ 所有测试通过!');
      process.exit(0);
    } else {
      console.log('\n❌ 部分测试失败');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ 测试运行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runTests();
