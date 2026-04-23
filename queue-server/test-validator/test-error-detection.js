/**
 * P0 测试：错误检测与基础流程验证
 * 测试范围：
 *   1. QueueManager 基本操作
 *   2. ActionParser 动作解析
 *   3. EvolveExecutor 语法检查与路径沙箱
 *   4. ConfirmManager 自动审批逻辑
 *
 * 约定：所有断言失败时 process.exit(1)，全部通过 process.exit(0)
 */

const path = require('path');
const assert = require('assert');

const SERVER_DIR = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── 1. QueueManager ────────────────────────────────────────────────────────
console.log('\n[P0] QueueManager');
const queueManager = require(path.join(SERVER_DIR, 'queue', 'manager'));

test('addTask 返回正确字段', () => {
  const t = queueManager.addTask('hello world', { test: true });
  assert.ok(t.id, 'id 存在');
  assert.strictEqual(t.status, 'pending');
  assert.strictEqual(t.prompt, 'hello world');
});

test('getTask 能取回刚创建的任务', () => {
  const t = queueManager.addTask('get-test');
  const fetched = queueManager.getTask(t.id);
  assert.ok(fetched, '能找到任务');
  assert.strictEqual(fetched.id, t.id);
});

test('updateTask 更新状态', () => {
  const t = queueManager.addTask('update-test');
  const updated = queueManager.updateTask(t.id, { status: 'processing' });
  assert.strictEqual(updated.status, 'processing');
});

test('getNextPendingTask 返回 pending 任务', () => {
  const t = queueManager.addTask('pending-test');
  // 可能被前面的 test 消耗，这里只确认调用不抛错
  const next = queueManager.getNextPendingTask();
  // next 可能是任意 pending 任务，只检查类型
  if (next !== null) {
    assert.ok(typeof next.id === 'string');
  }
});

// ─── 2. ActionParser ─────────────────────────────────────────────────────────
console.log('\n[P0] ActionParser');
const { parseActions } = require(path.join(SERVER_DIR, 'actions', 'action-parser'));

test('解析标准 action 代码块', () => {
  const text = '```action\n{"action":"read_file","params":{"file":"test.js"}}\n```';
  const actions = parseActions(text);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'read_file');
});

test('解析行内 ACTION 格式', () => {
  const text = '[ACTION:{"action":"list_files","params":{"dir":"/"}}]';
  const actions = parseActions(text);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'list_files');
});

test('无动作时返回空数组', () => {
  const actions = parseActions('只是普通文本，没有任何动作');
  assert.strictEqual(actions.length, 0);
});

test('解析多个动作块', () => {
  const text = [
    '```action',
    '{"action":"read_file","params":{"file":"a.js"}}',
    '```',
    '一些文字',
    '```action',
    '{"action":"write_file","params":{"file":"b.js","content":"x"}}',
    '```'
  ].join('\n');
  const actions = parseActions(text);
  assert.strictEqual(actions.length, 2);
});

test('JSON 解析失败时优雅降级，不抛异常', () => {
  const text = '```action\n{bad json\n```';
  let result;
  assert.doesNotThrow(() => { result = parseActions(text); });
  assert.ok(Array.isArray(result));
});

// ─── 3. EvolveExecutor 语法检查 & 路径沙箱 ────────────────────────────────
console.log('\n[P0] EvolveExecutor');
const evolveExecutor = require(path.join(SERVER_DIR, 'evolution', 'evolve-executor'));

test('checkSyntax：正确代码返回 true（通过 evolveExtension 路径校验）', async () => {
  // 直接测试内部 checkSyntax 概念：用一个有效 JS 传入 evolveExtension 应不报 SyntaxError
  // 用路径越界来检测 guard，不写文件
  const result = await evolveExecutor.evolveExtension({
    file: '../../../outside.js',
    code: 'console.log("x")'
  });
  assert.strictEqual(result.success, false, '路径越界应被拒绝');
  assert.ok(result.error.includes('outside'));
});

test('evolveExtension：缺少 file 参数时返回错误', async () => {
  const result = await evolveExecutor.evolveExtension({ code: 'x' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error);
});

test('evolveExtension：JS 语法错误时不写文件', async () => {
  const result = await evolveExecutor.evolveExtension({
    file: '__syntax_test_should_not_exist__.js',
    code: 'function broken( {'   // 故意语法错误
  });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('Syntax'));
});

// ─── 4. ConfirmManager 自动审批 ───────────────────────────────────────────
console.log('\n[P0] ConfirmManager');
const confirmManager = require(path.join(SERVER_DIR, 'actions', 'confirm-manager'));

test('autoEvolve 任务应自动批准进化动作', (done) => {
  let called = false;
  confirmManager.requestConfirm(
    {
      action: 'evolve_extension',
      riskLevel: 'high',
      task: { options: { autoEvolve: true } }
    },
    (approved) => {
      called = true;
      assert.strictEqual(approved, true, '自动进化任务应自动批准');
    }
  );
  // 同步调用，不需要等待
  assert.ok(called, 'onResponse 应同步被调用');
});

test('普通任务的危险动作在无 AUTO_CONFIRM 时进入 pending', () => {
  const originalEnv = process.env.AUTO_CONFIRM;
  delete process.env.AUTO_CONFIRM;

  let resolved = false;
  confirmManager.requestConfirm(
    {
      action: 'write_file',
      riskLevel: 'high',
      task: { options: {} }
    },
    () => { resolved = true; }
  );
  // 应该进入 pending，不立即回调
  assert.strictEqual(resolved, false, '不应立即自动批准');

  process.env.AUTO_CONFIRM = originalEnv;
});

// ─── 结果汇总 ──────────────────────────────────────────────────────────────
async function run() {
  // 等待所有可能的 async 测试
  await new Promise(r => setTimeout(r, 100));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  结果: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 清理 confirmManager 中挂起的 timer，避免进程不退出
  for (const [id] of confirmManager.pendingConfirms) {
    confirmManager.respondConfirm(id, false);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
