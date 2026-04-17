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

const SERVICES = {
  'SOLOCoder-QueueServer': {
    dir: QUEUE_DIR,
    type: 'queue',
    preferredPort: sharedConfig.queueServer.preferredPort,
    args: [path.join(QUEUE_DIR, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), 'index.js']
  },
  'SOLOCoder-WebConsole': {
    dir: WEB_DIR,
    type: 'web',
    port: 5173,
    args: [path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')]
  }
};

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
    // Fall through and try the direct pid.
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
  if (isPidAlive(rootPid)) {
    return true;
  }

  if (isPidAlive(Number(record.listenerPid || 0))) {
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

  if (!fs.existsSync(service.args[0])) {
    return {
      ok: false,
      error: `Missing launcher for ${name}: ${service.args[0]}`
    };
  }

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

    return {
      ok: true
    };
  } catch (error) {
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

  killPidTree(rootPid);

  if (listenerPid && listenerPid !== rootPid) {
    killPidTree(listenerPid);
  }

  if (service.type === 'queue') {
    const queueTarget = await discoverQueueService(1000);
    const queuePort = record?.port || queueTarget?.port || null;
    const liveQueuePid = getPidByPort(queuePort);
    if (liveQueuePid && liveQueuePid !== rootPid && liveQueuePid !== listenerPid) {
      killPidTree(liveQueuePid);
    }
  } else {
    const livePortPid = getPidByPort(service.port);
    if (livePortPid && livePortPid !== rootPid && livePortPid !== listenerPid) {
      killPidTree(livePortPid);
    }
  }

  delete pids[name];
  savePids(pids);
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

  if (cmd === 'status') {
    await sendStatus();
    return;
  }

  if (cmd === 'start_queue') {
    const status = await getStatus();
    if (!status.queueServerRunning && !hasLiveServiceProcess('SOLOCoder-QueueServer')) {
      const result = startServer('SOLOCoder-QueueServer');
      if (!result.ok) {
        sendMessage({
          type: 'error',
          message: `Failed to start Queue Server: ${result.error}`
        });
        return;
      }
    }
  } else if (cmd === 'stop_queue') {
    await stopServer('SOLOCoder-QueueServer');
  } else if (cmd === 'start_web') {
    const status = await getStatus();
    if (!status.webConsoleRunning && !hasLiveServiceProcess('SOLOCoder-WebConsole')) {
      const result = startServer('SOLOCoder-WebConsole');
      if (!result.ok) {
        sendMessage({
          type: 'error',
          message: `Failed to start Web Console: ${result.error}`
        });
        return;
      }
    }
  } else if (cmd === 'stop_web') {
    await stopServer('SOLOCoder-WebConsole');
  }

  const delay = cmd.indexOf('stop') === 0 ? 3000 : 1500;
  setTimeout(() => {
    void sendStatus();
  }, delay);
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
