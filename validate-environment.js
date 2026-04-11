const { execSync } = require('child_process');
const fs = require('fs');

function validateEnvironment() {
  const checks = [];

  // 检查Node.js版本
  try {
    const nodeVersion = execSync('node --version').toString().trim();
    checks.push({
      name: 'Node.js version',
      status: nodeVersion.startsWith('v16') || nodeVersion.startsWith('v18') || nodeVersion.startsWith('v20') || nodeVersion.startsWith('v22'),
      value: nodeVersion
    });
  } catch (error) {
    checks.push({ name: 'Node.js version', status: false, value: 'Not found' });
  }

  // 检查Queue-Server目录
  const queueServerDir = 'queue-server';
  checks.push({
    name: 'Queue-Server directory',
    status: fs.existsSync(queueServerDir),
    value: queueServerDir
  });

  // 检查package.json
  const packageJson = `${queueServerDir}/package.json`;
  checks.push({
    name: 'package.json',
    status: fs.existsSync(packageJson),
    value: packageJson
  });

  // 检查Chrome扩展目录
  const chromeExtensionDir = 'chromevideo';
  checks.push({
    name: 'Chrome extension directory',
    status: fs.existsSync(chromeExtensionDir),
    value: chromeExtensionDir
  });

  // 检查关键文件
  const criticalFiles = [
    'queue-server/websocket/handler.js',
    'queue-server/actions/confirm-manager.js',
    'chromevideo/auto-evolve-monitor.js',
    'chromevideo/background.js',
    'chromevideo/content.js'
  ];

  criticalFiles.forEach(file => {
    checks.push({
      name: `File: ${file}`,
      status: fs.existsSync(file),
      value: file
    });
  });

  // 输出验证结果
  console.log('=== Environment Validation Results ===');
  checks.forEach(check => {
    console.log(`${check.status ? '✅' : '❌'} ${check.name}: ${check.value}`);
  });

  const allPassed = checks.every(check => check.status);
  return { allPassed, checks };
}

// 运行验证
const result = validateEnvironment();
if (!result.allPassed) {
  console.error('Environment validation failed. Please fix the issues above.');
  process.exit(1);
}

console.log('✅ Environment validation passed!');
console.log('\nNext steps:');
console.log('1. Install Queue-Server dependencies: cd queue-server && npm install');
console.log('2. Start Queue-Server: cd queue-server && npm start');
console.log('3. Load Chrome extension in browser');