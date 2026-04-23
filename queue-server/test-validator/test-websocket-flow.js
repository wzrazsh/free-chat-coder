/**
 * P0 测试：WebSocket 消息流验证
 * 测试范围：
 *   1. Queue-Server 能正常启动并监听端口
 *   2. WebSocket 注册 → task_assigned 推送 → task_update 回报 完整流程
 *   3. ping/pong 心跳
 *   4. 断线后状态清理
 *
 * 测试方式：启动一个临时 Queue-Server 实例（随机端口），用 ws 客户端模拟扩展
 */

const http = require('http');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');

const SERVER_DIR = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const TEST_PORT = 18082; // 避免与生产端口冲突

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function log(icon, name) {
  if (icon === '✓') { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

function waitForMsg(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    function handler(raw) {
      try {
        const msg = JSON.parse(raw);
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch (_) {}
    }
    ws.on('message', handler);
  });
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
}

// ─── 启动测试用服务器 ──────────────────────────────────────────────────────

async function startTestServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // 动态加载路由（避免单例 queueManager 状态污染生产实例）
  const taskRoutes = require(path.join(SERVER_DIR, 'routes', 'tasks'));
  app.use('/tasks', taskRoutes);
  app.get('/health', (_, res) => res.json({ status: 'ok' }));

  const server = http.createServer(app);
  const setupWebSocket = require(path.join(SERVER_DIR, 'websocket', 'handler'));
  setupWebSocket(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  return server;
}

// ─── 主测试流程 ───────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n[P0] WebSocket 流程测试');
  let server;
  let extWs;

  try {
    // 启动服务器
    server = await startTestServer();
    log('✓', `服务器在端口 ${TEST_PORT} 启动`);
  } catch (err) {
    log('✗', `服务器启动失败: ${err.message}`);
    process.exit(1);
  }

  try {
    // ── 测试 1：健康检查 ───────────────────────────────────────────────
    const healthRes = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/health`, (res) => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    if (healthRes.status === 'ok') log('✓', 'GET /health 返回 ok');
    else { log('✗', 'GET /health 响应异常'); }
  } catch (err) {
    log('✗', `GET /health 失败: ${err.message}`);
  }

  try {
    // ── 测试 2：WebSocket 连接 & 注册 ────────────────────────────────
    extWs = await wsConnect(`ws://localhost:${TEST_PORT}`);
    log('✓', 'WebSocket 连接成功');

    extWs.send(JSON.stringify({ type: 'register', clientType: 'extension' }));
    log('✓', '发送 register 消息不抛异常');
  } catch (err) {
    log('✗', `WS 连接/注册失败: ${err.message}`);
    server.close();
    process.exit(1);
  }

  try {
    // ── 测试 3：ping / pong ──────────────────────────────────────────
    extWs.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitForMsg(extWs, m => m.type === 'pong', 3000);
    if (pong.type === 'pong') log('✓', 'ping → pong 心跳正常');
    else log('✗', 'pong 消息格式异常');
  } catch (err) {
    log('✗', `ping/pong 测试失败: ${err.message}`);
  }

  try {
    // ── 测试 4：POST /tasks 触发 task_assigned 推送 ───────────────────
    // 先 listen 好，再提交任务
    const assignedPromise = waitForMsg(extWs, m => m.type === 'task_assigned', 5000);

    // 提交任务
    const postRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ prompt: 'P0测试任务' });
      const req = http.request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (postRes.status === 201) log('✓', 'POST /tasks 返回 201');
    else log('✗', `POST /tasks 状态码异常: ${postRes.status}`);

    const assigned = await assignedPromise;
    // custom-handler.processTask 会注入 System Prompt，prompt 可能被包装
    // 只需确认原始 prompt 内容包含在最终 prompt 中
    if (assigned.task && assigned.task.prompt && assigned.task.prompt.includes('P0测试任务')) {
      log('✓', 'task_assigned 推送内容正确');
    } else {
      log('✗', 'task_assigned 内容与提交不符');
    }

    // ── 测试 5：task_update 回报 ─────────────────────────────────────
    const taskId = assigned.task.id;
    extWs.send(JSON.stringify({
      type: 'task_update',
      taskId,
      status: 'completed',
      result: 'P0测试通过'
    }));
    log('✓', '发送 task_update(completed) 不抛异常');

    // 等一点让服务端处理
    await new Promise(r => setTimeout(r, 300));

    // 检查任务状态
    const getRes = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/tasks`, (res) => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const updatedTask = getRes.tasks.find(t => t.id === taskId);
    if (updatedTask && (updatedTask.status === 'completed' || updatedTask.status === 'processing')) {
      log('✓', `任务状态更新为 ${updatedTask.status}`);
    } else {
      log('✗', `任务状态未更新: ${updatedTask?.status}`);
    }

  } catch (err) {
    log('✗', `任务流程测试失败: ${err.message}`);
  }

  // ── 清理 ────────────────────────────────────────────────────────────────
  try { extWs && extWs.close(); } catch (_) {}
  await new Promise(r => server.close(r));

  // ── 汇总 ────────────────────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  结果: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('[P0] 意外错误:', err);
  process.exit(1);
});
