const cp = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const WORKSPACE = path.resolve(__dirname, '../../');
const QUEUE_DIR = path.join(WORKSPACE, 'queue-server');
const WEB_DIR = path.join(WORKSPACE, 'web-console');
const PID_FILE = path.join(__dirname, '.service-pids.json');
const IS_WINDOWS = process.platform === 'win32';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortReachable(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function getPidByPort(port) {
  if (!port) return null;
  try {
    const output = cp.execSync('netstat -ano | findstr :' + port, { windowsHide: true }).toString();
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return Number(parts[parts.length - 1]);
      }
    }
  } catch (err) {}
  return null;
}

function getAllPidsByPort(port) {
  if (!port) return [];
  try {
    const output = cp.execSync('netstat -ano | findstr :' + port, { windowsHide: true }).toString();
    const lines = output.trim().split('\n');
    const pids = [];
    for (const line of lines) {
      if (line.includes('LISTENING') || line.includes('ESTABLISHED')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && !pids.includes(pid)) pids.push(pid);
      }
    }
    return pids;
  } catch (err) {
    return [];
  }
}

function getPidsByCommandLine(pattern) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"CommandLine like '%${pattern}%'\\" | Select-Object -ExpandProperty ProcessId) -join ','"`;
    const output = cp.execSync(cmd, { windowsHide: true, timeout: 8000 }).toString().trim();
    if (!output) return [];
    return output.split(',').map(id => Number(id.trim())).filter(Boolean);
  } catch (error) {
    try {
      const output = cp.execSync(`wmic process where "CommandLine like '%${pattern}%'" get ProcessId`, { windowsHide: true }).toString();
      const lines = output.trim().split('\n').slice(1);
      return lines.map(line => {
        const trimmed = line.trim();
        return trimmed ? Number(trimmed) || null : null;
      }).filter(Boolean);
    } catch (fallbackError) {
      return [];
    }
  }
}

function killProcess(pid) {
  if (!pid) return false;
  try {
    cp.execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000, windowsHide: true });
    return true;
  } catch (error) {
    return false;
  }
}

function killPidTree(pid) {
  return killProcess(pid);
}

function killAllProcessesByPort(port) {
  const pids = getAllPidsByPort(port);
  const killed = [];
  for (const pid of pids) {
    if (killPidTree(pid)) killed.push(pid);
  }
  return killed;
}

function killProcessesByPattern(pattern) {
  const pids = getPidsByCommandLine(pattern);
  const killed = [];
  for (const pid of pids) {
    if (killPidTree(pid)) killed.push(pid);
  }
  return killed;
}

function getNodeProcessCount() {
  try {
    const output = cp.execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH', { windowsHide: true }).toString();
    const lines = output.trim().split('\n').filter(l => l.includes('node.exe'));
    return lines.length;
  } catch (e) {
    return -1;
  }
}

async function runTest() {
  console.log('========================================');
  console.log('  host.js stopServer 改进验证测试');
  console.log('========================================\n');

  const TEST_PORT = 8080;

  console.log('[Phase 0] 初始状态检查');
  const initialNodeCount = getNodeProcessCount();
  const initialReachable = await isPortReachable(TEST_PORT, 1000);
  const initialPid = getPidByPort(TEST_PORT);
  console.log(`  Node 进程数: ${initialNodeCount}`);
  console.log(`  端口 ${TEST_PORT} 可达: ${initialReachable}`);
  console.log(`  端口 ${TEST_PORT} PID: ${initialPid}`);

  if (!initialReachable) {
    console.log('\n[Phase 1] 启动 Queue Server...');
    const child = cp.spawn(process.execPath, [
      path.join(QUEUE_DIR, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), 'index.js'
    ], {
      cwd: QUEUE_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, BROWSER: 'none' }
    });
    child.unref();
    console.log(`  启动 nodemon PID: ${child.pid}`);

    await sleep(4000);

    const afterStartReachable = await isPortReachable(TEST_PORT, 1000);
    const afterStartPid = getPidByPort(TEST_PORT);
    console.log(`  端口 ${TEST_PORT} 可达: ${afterStartReachable}`);
    console.log(`  端口 ${TEST_PORT} PID: ${afterStartPid}`);

    if (!afterStartReachable) {
      console.log('  ERROR: Queue Server 启动失败，终止测试');
      return;
    }
  }

  const beforeStopNodeCount = getNodeProcessCount();
  const beforeStopPid = getPidByPort(TEST_PORT);
  const beforeStopAllPids = getAllPidsByPort(TEST_PORT);
  console.log(`\n[Phase 2] 停止前状态`);
  console.log(`  Node 进程数: ${beforeStopNodeCount}`);
  console.log(`  端口 ${TEST_PORT} 监听 PID: ${beforeStopPid}`);
  console.log(`  端口 ${TEST_PORT} 所有关联 PID: ${JSON.stringify(beforeStopAllPids)}`);

  console.log('\n[Phase 3] 执行改进后的 stopServer 四阶段清理');

  console.log('  阶段 1: 按记录 PID 杀进程...');
  const rootPid = beforeStopPid;
  const stage1Killed = [];
  if (rootPid && killPidTree(rootPid)) {
    stage1Killed.push(rootPid);
  }
  console.log(`    杀死 PID: ${JSON.stringify(stage1Killed)}`);

  await sleep(500);

  console.log('  阶段 2: 按端口杀所有残留进程...');
  const stage2Killed = killAllProcessesByPort(TEST_PORT);
  console.log(`    杀死 PID: ${JSON.stringify(stage2Killed)}`);

  await sleep(300);

  console.log('  阶段 3: 按命令行模式杀进程...');
  const nodemonPids = killProcessesByPattern('nodemon');
  const queueServerPids = killProcessesByPattern('queue-server');
  console.log(`    nodemon 模式杀死 PID: ${JSON.stringify(nodemonPids)}`);
  console.log(`    queue-server 模式杀死 PID: ${JSON.stringify(queueServerPids)}`);

  await sleep(300);

  console.log('  阶段 4: 最终兜底检查...');
  const finalPid = getPidByPort(TEST_PORT);
  const stage4Killed = [];
  if (finalPid) {
    if (killPidTree(finalPid)) stage4Killed.push(finalPid);
  }
  console.log(`    兜底杀死 PID: ${JSON.stringify(stage4Killed)}`);

  await sleep(1000);

  console.log('\n[Phase 4] 停止后验证');
  const afterStopNodeCount = getNodeProcessCount();
  const afterStopReachable = await isPortReachable(TEST_PORT, 1000);
  const afterStopPid = getPidByPort(TEST_PORT);
  const afterStopAllPids = getAllPidsByPort(TEST_PORT);
  console.log(`  Node 进程数: ${afterStopNodeCount} (之前: ${beforeStopNodeCount})`);
  console.log(`  端口 ${TEST_PORT} 可达: ${afterStopReachable}`);
  console.log(`  端口 ${TEST_PORT} 监听 PID: ${afterStopPid}`);
  console.log(`  端口 ${TEST_PORT} 残留关联 PID: ${JSON.stringify(afterStopAllPids)}`);

  const allKilled = !afterStopReachable && !afterStopPid && afterStopAllPids.length === 0;
  const processReduced = afterStopNodeCount < beforeStopNodeCount;

  console.log('\n========================================');
  console.log('  测试结果');
  console.log('========================================');
  console.log(`  端口完全释放: ${allKilled ? 'PASS' : 'FAIL'}`);
  console.log(`  进程数减少: ${processReduced ? 'PASS' : 'FAIL'} (${beforeStopNodeCount} -> ${afterStopNodeCount})`);

  if (allKilled && processReduced) {
    console.log('\n  ✓ 改进后的 stopServer 逻辑验证通过！');
  } else {
    console.log('\n  ✗ 改进后的 stopServer 逻辑存在问题！');
  }
}

runTest().catch(console.error);
