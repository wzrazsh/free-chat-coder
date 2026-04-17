const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKSPACE = path.resolve(__dirname, '../../');
const QUEUE_DIR = path.join(WORKSPACE, 'queue-server');
const WEB_DIR = path.join(WORKSPACE, 'web-console');
const PID_FILE = path.join(__dirname, '.service-pids.json');

const SERVICES = {
  'SOLOCoder-QueueServer': {
    dir: QUEUE_DIR,
    port: 8082,
    args: [path.join(QUEUE_DIR, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), 'index.js']
  },
  'SOLOCoder-WebConsole': {
    dir: WEB_DIR,
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
    // Port not in use or error
  }
  return null;
}

function loadPids() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function savePids(data) {
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* ignore */ }
}

function getRecordedRootPid(record) {
  if (!record) return null;
  return Number(record.pid || record.cmdPid || 0) || null;
}

function isPidAlive(pid) {
  if (!pid) return false;

  try {
    const output = cp.execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { windowsHide: true }).toString().trim();
    return !!output && !output.startsWith('INFO:') && !output.includes('No tasks are running');
  } catch (e) {
    return false;
  }
}

function killPidTree(pid) {
  if (!pid) return false;

  try {
    cp.execSync('taskkill /F /T /PID ' + pid, { timeout: 5000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

function removeServiceRecord(name) {
  const pids = loadPids();
  if (!pids[name]) return;
  delete pids[name];
  savePids(pids);
}

function updateRecordedListenerPid(name) {
  const service = SERVICES[name];
  if (!service) return;

  const listenerPid = getPidByPort(service.port);
  if (!listenerPid) return;

  const pids = loadPids();
  if (!pids[name]) return;

  pids[name].listenerPid = listenerPid;
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
  if (!service || !fs.existsSync(service.args[0])) {
    return false;
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
      port: service.port,
      startedAt: new Date().toISOString()
    };
    savePids(pids);

    child.unref();

    setTimeout(function() {
      updateRecordedListenerPid(name);
    }, 3000);

    return true;
  } catch (err) {
    removeServiceRecord(name);
    return false;
  }
}

function stopServer(name) {
  const service = SERVICES[name];
  if (!service) return;

  const pids = loadPids();
  const record = pids[name];
  const rootPid = getRecordedRootPid(record);
  const listenerPid = Number(record && record.listenerPid ? record.listenerPid : 0) || null;
  const livePortPid = getPidByPort(service.port);

  killPidTree(rootPid);

  if (listenerPid && listenerPid !== rootPid) {
    killPidTree(listenerPid);
  }

  if (livePortPid && livePortPid !== rootPid && livePortPid !== listenerPid) {
    killPidTree(livePortPid);
  }

  delete pids[name];
  savePids(pids);
}

function getStatus() {
  return {
    queueServerRunning: !!getPidByPort(SERVICES['SOLOCoder-QueueServer'].port),
    webConsoleRunning: !!getPidByPort(SERVICES['SOLOCoder-WebConsole'].port)
  };
}

function processCommand(msg) {
  if (!msg || !msg.command) return;

  var cmd = msg.command;
  var response = { type: 'result', command: cmd };

  if (cmd === 'status') {
    response.type = 'status';
    Object.assign(response, getStatus());
  } else if (cmd === 'start_queue') {
    if (!getPidByPort(SERVICES['SOLOCoder-QueueServer'].port) && !hasLiveServiceProcess('SOLOCoder-QueueServer')) {
      startServer('SOLOCoder-QueueServer');
    }
  } else if (cmd === 'stop_queue') {
    stopServer('SOLOCoder-QueueServer');
  } else if (cmd === 'start_web') {
    if (!getPidByPort(SERVICES['SOLOCoder-WebConsole'].port) && !hasLiveServiceProcess('SOLOCoder-WebConsole')) {
      startServer('SOLOCoder-WebConsole');
    }
  } else if (cmd === 'stop_web') {
    stopServer('SOLOCoder-WebConsole');
  }

  if (cmd !== 'status') {
    var delay = cmd.indexOf('stop') === 0 ? 3000 : 1500;
    setTimeout(function() {
      sendMessage({
        type: 'status',
        queueServerRunning: !!getPidByPort(SERVICES['SOLOCoder-QueueServer'].port),
        webConsoleRunning: !!getPidByPort(SERVICES['SOLOCoder-WebConsole'].port)
      });
    }, delay);
  } else {
    sendMessage(response);
  }
}

var buffer = Buffer.alloc(0);
process.stdin.on('data', function(chunk) {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 4) {
    var msgLen = buffer.readUInt32LE(0);
    if (buffer.length < 4 + msgLen) {
      break;
    }

    var msgBuf = buffer.slice(4, 4 + msgLen);
    buffer = buffer.slice(4 + msgLen);

    try {
      var msg = JSON.parse(msgBuf.toString('utf8'));
      processCommand(msg);
    } catch (err) {
      sendMessage({ type: 'error', message: 'Failed to parse message: ' + err.message });
    }
  }
});
