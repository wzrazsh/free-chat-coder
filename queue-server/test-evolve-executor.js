const evolveExecutor = require('./evolution/evolve-executor');
const path = require('path');
const fs = require('fs');

console.log('Testing evolve-executor...');

// 创建一个测试文件
const testFile = 'test-dummy-evolve.js';
const fullPath = path.join(__dirname, '../chromevideo', testFile);
if (!fs.existsSync(path.dirname(fullPath))) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}
fs.writeFileSync(fullPath, 'console.log("Original code");', 'utf8');

console.log('Original file created.');

// 模拟 AI 节点返回新代码
const result = evolveExecutor.evolveExtension({
  file: testFile,
  code: 'console.log("Evolved code");\nconsole.log("Fixed the selector!");'
});

console.log('\nEvolution Result:', result);

if (fs.existsSync(fullPath + '.bak')) {
  console.log('\nBackup file created successfully.');
  console.log('Backup content:', fs.readFileSync(fullPath + '.bak', 'utf8'));
}

console.log('\nNew file content:', fs.readFileSync(fullPath, 'utf8'));

// 清理测试文件
fs.unlinkSync(fullPath);
if (fs.existsSync(fullPath + '.bak')) {
  fs.unlinkSync(fullPath + '.bak');
}
console.log('\nTest cleanup done.');
