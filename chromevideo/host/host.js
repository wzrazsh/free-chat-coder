const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const sharedConfig = require('../../shared/config');
const { discoverQueueServer } = require('../../shared/queue-server');

const WORKSPACE = path.resolve(__dirname, '../../');
const QUEUE_DIR = path.join(WORKSPACE, 'queue-server');
const WEB_DIR = path.join(WORKSPACE, 'web-console');
const PID_FILE = path.join(__dirname, '.service-pids.json');
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_STARTUP_TIMEOUT_MS = 15000;
const SERVICE_STATE_POLL_MS = 500;

const SERVICES = {
  'SOLOCoder-QueueServer': {
    displayName: 'Queue Server',
    dir: QUEUE_DIR,
    type: 'queue',
    preferredPort: sharedConfig.queueServer.preferredPort,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    args: [path.join(QUEUE_DIR, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), 'index.js']
  },
  'SOLOCoder-WebConsole': {
    displayName: 'Web Console',
    dir: WEB_DIR,
    type: 'web',
    port: 5173,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    args: [path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')]
  }
};

const startingServices = new Set();

function sendMessage(msg) {
  const buffer = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

function getPidByPort(port) {
  if (!port) {
    return null;
  }

  if (!IS_WINDOWS) {
    try {
      const output = cp.execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' });
      const lines = output.trim().split('\n').filter(Boolean);
      const portPattern = new RegExp(`:${port}\\b`);

      for (const line of lines) {
        if (!portPattern.test(line)) {
          continue;
        }

        const match = line.match(/pid=(\d+)/);
        if (match) {
          return Number(match[1]);
        }
      }
    } catch (error) {
      // Ignore missing ss output and fall back to null.
    }

    return null;
  }

  try {
    const output = cp.execSync('netstat -ano | findstr :' + port, { windowsHide: true }).toString();
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return Number(parts[parts.length - 1]);
      }
    }
  } catch (err) {
    // Port not in use or error.
  }
  return null;
}

function loadPids() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    }
  } catch (error) {
    // Ignore broken pid cache and rebuild it on next write.
  }
  return {};
}

function savePids(data) {
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    // Ignore write failures in the native host helper.
  }
}

function getRecordedRootPid(record) {
  if (!record) return null;
  return Number(record.pid || record.cmdPid || 0) || null;
}

function isPidAlive(pid) {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') {
      return true;
    }
  }

  if (IS_WINDOWS) {
    try {
      const output = cp.execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }).toString().trim();
      return !!output && !output.startsWith('INFO:') && !output.includes('No tasks are running');
    } catch (error) {
      return false;
    }
  }

  return false;
}

function isPortReachable(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
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

function killProcess(pid) {
  if (!pid) {
    return false;
  }

  if (IS_WINDOWS) {
    try {
      cp.execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000, windowsHide: true });
      return true;
    } catch (error) {
      return false;
    }
  }

  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch (error) {
  }

  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch (error) {
    return false;
  }
}

function killPidTree(pid) {
  return killProcess(pid);
}

function getProcessCommandLine(pid) {
  if (!pid) {
    return '';
  }

  if (!IS_WINDOWS) {
    try {
      return cp.execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    } catch (error) {
      return '';
    }
  }

  try {
    const cmd = `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`;
    const output = cp.execSync(cmd, { windowsHide: true, timeout: 5000 }).toString().trim();
    return output || '';
  } catch (error) {
    try {
      const output = cp.execSync(`wmic process where "ProcessId=${pid}" get CommandLine /value`, { windowsHide: true }).toString();
      const match = output.match(/CommandLine=(.*)/);
      return match ? match[1].trim() : '';
    } catch (fallbackError) {
      return '';
    }
  }
}

function getServiceProcessPatterns(name) {
  const service = SERVICES[name];
  if (!service) {
    return [];
  }

  const patterns = [];

  if (service.dir) {
    patterns.push(path.basename(service.dir));
  }

  for (const arg of service.args || []) {
    const normalized = String(arg || '').replace(/\\/g, '/');
    if (!normalized) {
      continue;
    }

    const basename = path.basename(normalized);
    if (basename) {
      patterns.push(basename);
    }
  }

  if (name === 'SOLOCoder-QueueServer') {
    patterns.push('queue-server', 'nodemon', 'index.js');
  } else if (name === 'SOLOCoder-WebConsole') {
    patterns.push('web-console', 'vite');
  }

  return [...new Set(patterns.map((item) => item.toLowerCase()).filter(Boolean))];
}

function isPidOwnedByService(name, pid, portHint = null) {
  if (!pid || !isPidAlive(pid)) {
    return false;
  }

  const service = SERVICES[name];
  if (!service) {
    return false;
  }

  const portsToCheck = [...new Set(
    [portHint, service.port]
      .map((value) => Number(value) || null)
      .filter(Boolean)
  )];

  for (const port of portsToCheck) {
    if (getAllPidsByPort(port).includes(pid)) {
      return true;
    }
  }

  const commandLine = getProcessCommandLine(pid).toLowerCase();
  if (!commandLine) {
    return false;
  }

  return getServiceProcessPatterns(name).some((pattern) => commandLine.includes(pattern));
}

function getAllPidsByPort(port) {
  if (!port) {
    return [];
  }

  if (!IS_WINDOWS) {
    try {
      const output = cp.execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' });
      const lines = output.trim().split('\n').filter(Boolean);
      const portPattern = new RegExp(`:${port}\\b`);
      const pids = [];

      for (const line of lines) {
        if (!portPattern.test(line)) {
          continue;
        }

        const match = line.match(/pid=(\d+)/);
        if (match) {
          const pid = Number(match[1]);
          if (!pids.includes(pid)) {
            pids.push(pid);
          }
        }
      }

      return pids;
    } catch (error) {
      return [];
    }
  }

  try {
    const output = cp.execSync('netstat -ano | findstr :' + port, { windowsHide: true }).toString();
    const lines = output.trim().split('\n');
    const pids = [];

    for (const line of lines) {
      if (line.includes('LISTENING') || line.includes('ESTABLISHED')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && !pids.includes(pid)) {
          pids.push(pid);
        }
      }
    }

    return pids;
  } catch (err) {
    return [];
  }
}

function getPidsByCommandLine(pattern) {
  if (!IS_WINDOWS) {
    try {
      const output = cp.execSync(`ps aux | grep -v grep | grep '${pattern}'`, { encoding: 'utf8' });
      const lines = output.trim().split('\n').filter(Boolean);
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return Number(parts[1]) || null;
      }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

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

function killAllProcessesByPort(port) {
  const pids = getAllPidsByPort(port);
  const killed = [];

  for (const pid of pids) {
    if (killPidTree(pid)) {
      killed.push(pid);
    }
  }

  return killed;
}

function killProcessesByPattern(pattern) {
  const pids = getPidsByCommandLine(pattern);
  const killed = [];

  for (const pid of pids) {
    if (killPidTree(pid)) {
      killed.push(pid);
    }
  }

  return killed;
}

function removeServiceRecord(name) {
  const pids = loadPids();
  if (!pids[name]) return;
  delete pids[name];
  savePids(pids);
}

async function discoverQueueService(timeoutMs = 1000) {
  return discoverQueueServer({
    host: sharedConfig.queueServer.host,
    timeoutMs
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getServiceRuntimeStatus(name) {
  const service = SERVICES[name];
  if (!service) {
    return {
      running: false,
      port: null,
      processAlive: false
    };
  }

  if (service.type === 'queue') {
    const queueTarget = await discoverQueueService(900);
    return {
      running: !!queueTarget,
      port: queueTarget ? queueTarget.port : null,
      processAlive: hasLiveServiceProcess(name)
    };
  }

  const reachable = await isPortReachable(service.port);
  return {
    running: reachable,
    port: service.port,
    processAlive: reachable || !!getPidByPort(service.port) || hasLiveServiceProcess(name)
  };
}

async function waitForServiceState(name, expectedRunning, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastStatus = await getServiceRuntimeStatus(name);

  while (lastStatus.running !== expectedRunning && (Date.now() - startedAt) < timeoutMs) {
    await sleep(SERVICE_STATE_POLL_MS);
    lastStatus = await getServiceRuntimeStatus(name);
  }

  if (lastStatus.running === expectedRunning && expectedRunning) {
    await updateRecordedListenerPid(name);
  }

  return {
    ok: lastStatus.running === expectedRunning,
    waitedMs: Date.now() - startedAt,
    status: lastStatus
  };
}

function formatServiceReadinessError(name, waitResult) {
  const service = SERVICES[name];
  const portText = waitResult.status.port || service.port
    ? `port ${waitResult.status.port || service.port}`
    : 'unknown port';
  const processText = waitResult.status.processAlive
    ? 'process is alive but not ready'
    : 'no live process detected';
  const waitedSeconds = Math.max(1, Math.round(waitResult.waitedMs / 1000));

  return `${service.displayName} did not become ready within ${waitedSeconds}s (${portText}; ${processText})`;
}

async function updateRecordedListenerPid(name) {
  const service = SERVICES[name];
  if (!service) return;

  let listenerPid = null;
  let activePort = service.port || null;

  if (service.type === 'queue') {
    const queueTarget = await discoverQueueService(1200);
    if (queueTarget) {
      activePort = queueTarget.port;
      listenerPid = getPidByPort(queueTarget.port);
    }
  } else {
    listenerPid = getPidByPort(service.port);
  }

  if (!listenerPid) return;

  const pids = loadPids();
  if (!pids[name]) return;

  pids[name].listenerPid = listenerPid;
  pids[name].port = activePort;
  pids[name].updatedAt = new Date().toISOString();
  savePids(pids);
}

function hasLiveServiceProcess(name) {
  const pids = loadPids();
  const record = pids[name];
  if (!record) return false;

  const rootPid = getRecordedRootPid(record);
  if (isPidOwnedByService(name, rootPid, record.port)) {
    return true;
  }

  if (isPidOwnedByService(name, Number(record.listenerPid || 0), record.port)) {
    return true;
  }

  delete pids[name];
  savePids(pids);
  return false;
}

function startServer(name) {
  const service = SERVICES[name];
  if (!service) {
    return {
      ok: false,
      error: `Unknown service: ${name}`
    };
  }

  if (startingServices.has(name)) {
    return {
      ok: false,
      error: `${service.displayName} is already starting`
    };
  }

  if (!fs.existsSync(service.args[0])) {
    return {
      ok: false,
      error: `Missing launcher for ${name}: ${service.args[0]}`
    };
  }

  if (hasLiveServiceProcess(name)) {
    return {
      ok: true,
      alreadyRunning: true
    };
  }

  const targetPort = service.type === 'queue' ? null : service.port;
  if (targetPort) {
    const existingPids = getAllPidsByPort(targetPort);
    if (existingPids.length > 0) {
      killAllProcessesByPort(targetPort);
    }
  }

  startingServices.add(name);

  try {
    const child = cp.spawn(process.execPath, service.args, {
      cwd: service.dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        BROWSER: 'none'
      }
    });

    const pids = loadPids();
    pids[name] = {
      pid: child.pid,
      port: service.type === 'queue' ? null : service.port,
      startedAt: new Date().toISOString()
    };
    savePids(pids);

    child.unref();

    setTimeout(() => {
      void updateRecordedListenerPid(name);
    }, 3000);

    setTimeout(() => {
      startingServices.delete(name);
    }, 5000);

    return {
      ok: true
    };
  } catch (error) {
    startingServices.delete(name);
    removeServiceRecord(name);
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function stopServer(name) {
  const service = SERVICES[name];
  if (!service) return;

  const pids = loadPids();
  const record = pids[name];
  const rootPid = getRecordedRootPid(record);
  const listenerPid = Number(record && record.listenerPid ? record.listenerPid : 0) || null;

  const killedByPid = [];

  if (isPidOwnedByService(name, rootPid, record?.port)) {
    if (killPidTree(rootPid)) {
      killedByPid.push(rootPid);
    }
  }

  if (listenerPid && listenerPid !== rootPid && isPidOwnedByService(name, listenerPid, record?.port)) {
    if (killPidTree(listenerPid)) {
      killedByPid.push(listenerPid);
    }
  }

  await sleep(500);

  const targetPort = service.type === 'queue'
    ? (record?.port || (await discoverQueueService(800))?.port || service.port)
    : service.port;

  if (targetPort) {
    const killedByPort = killAllProcessesByPort(targetPort);
    killedByPid.push(...killedByPort.filter(pid => !killedByPid.includes(pid)));
  }

  await sleep(300);

  const patterns = [];
  if (name === 'SOLOCoder-QueueServer') {
    patterns.push('nodemon', 'queue-server');
  } else if (name === 'SOLOCoder-WebConsole') {
    patterns.push('vite', 'web-console');
  }

  for (const pattern of patterns) {
    const killedByPattern = killProcessesByPattern(pattern);
    killedByPid.push(...killedByPattern.filter(pid => !killedByPid.includes(pid)));
  }

  await sleep(300);

  if (service.type === 'queue') {
    const finalQueueTarget = await discoverQueueService(500);
    if (finalQueueTarget) {
      const finalQueuePid = getPidByPort(finalQueueTarget.port);
      if (finalQueuePid && !killedByPid.includes(finalQueuePid)) {
        killPidTree(finalQueuePid);
        killedByPid.push(finalQueuePid);
      }
    }
  } else {
    const finalPortPid = getPidByPort(service.port);
    if (finalPortPid && !killedByPid.includes(finalPortPid)) {
      killPidTree(finalPortPid);
      killedByPid.push(finalPortPid);
    }
  }

  delete pids[name];
  savePids(pids);

  return {
    killedPids: killedByPid,
    port: targetPort
  };
}

async function getStatus() {
  const queueTarget = await discoverQueueService(900);
  const webConsoleRunning = await isPortReachable(SERVICES['SOLOCoder-WebConsole'].port)
    || !!getPidByPort(SERVICES['SOLOCoder-WebConsole'].port)
    || hasLiveServiceProcess('SOLOCoder-WebConsole');

  return {
    queueServerRunning: !!queueTarget,
    queueServerPort: queueTarget ? queueTarget.port : null,
    webConsoleRunning
  };
}

async function sendStatus() {
  sendMessage({
    type: 'status',
    ...(await getStatus())
  });
}

async function processCommand(msg) {
  if (!msg || !msg.command) return;

  const cmd = msg.command;
  let postActionDelay = 0;

  if (cmd === 'status') {
    await sendStatus();
    return;
  }

  if (cmd === 'start_queue') {
    const serviceName = 'SOLOCoder-QueueServer';
    const status = await getStatus();
    if (!status.queueServerRunning && !hasLiveServiceProcess(serviceName)) {
      const result = startServer(serviceName);
      if (!result.ok) {
        sendMessage({
          type: 'error',
          message: `Failed to start Queue Server: ${result.error}`
        });
        return;
      }
    }

    if (!status.queueServerRunning) {
      const waitResult = await waitForServiceState(serviceName, true, SERVICES[serviceName].startupTimeoutMs);
      if (!waitResult.ok) {
        sendMessage({
          type: 'error',
          message: formatServiceReadinessError(serviceName, waitResult)
        });
        return;
      }
    }
  } else if (cmd === 'stop_queue') {
    await stopServer('SOLOCoder-QueueServer');
    postActionDelay = 3000;
  } else if (cmd === 'start_web') {
    const serviceName = 'SOLOCoder-WebConsole';
    const status = await getStatus();
    if (!status.webConsoleRunning && !hasLiveServiceProcess(serviceName)) {
      const result = startServer(serviceName);
      if (!result.ok) {
        sendMessage({
          type: 'error',
          message: `Failed to start Web Console: ${result.error}`
        });
        return;
      }
    }

    if (!status.webConsoleRunning) {
      const waitResult = await waitForServiceState(serviceName, true, SERVICES[serviceName].startupTimeoutMs);
      if (!waitResult.ok) {
        sendMessage({
          type: 'error',
          message: formatServiceReadinessError(serviceName, waitResult)
        });
        return;
      }
    }
  } else if (cmd === 'stop_web') {
    await stopServer('SOLOCoder-WebConsole');
    postActionDelay = 3000;
  }

  if (postActionDelay > 0) {
    setTimeout(() => {
      void sendStatus();
    }, postActionDelay);
    return;
  }

  await sendStatus();
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', function(chunk) {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 4) {
    const msgLen = buffer.readUInt32LE(0);
    if (buffer.length < 4 + msgLen) {
      break;
    }

    const msgBuf = buffer.slice(4, 4 + msgLen);
    buffer = buffer.slice(4 + msgLen);

    try {
      const msg = JSON.parse(msgBuf.toString('utf8'));
      void processCommand(msg).catch((error) => {
        sendMessage({ type: 'error', message: error.message || String(error) });
      });
    } catch (error) {
      sendMessage({ type: 'error', message: 'Failed to parse message: ' + error.message });
    }
  }
});
