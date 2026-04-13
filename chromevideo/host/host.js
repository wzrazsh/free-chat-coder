const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKSPACE = path.resolve(__dirname, '../../');
const QUEUE_DIR = path.join(WORKSPACE, 'queue-server');
const WEB_DIR = path.join(WORKSPACE, 'web-console');

// Send message back to Chrome extension
function sendMessage(msg) {
  const buffer = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

// Check if a port is in use and return PID
function getPidByPort(port) {
  try {
    const output = cp.execSync(`netstat -ano | findstr :${port}`).toString();
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.includes(`LISTENING`)) {
        const parts = line.trim().split(/\s+/);
        return parts[parts.length - 1]; // The PID
      }
    }
  } catch (err) {
    // Port not in use or error
  }
  return null;
}

function startServer(name, dir, cmdStr) {
  try {
    // Opens a new visible command prompt window, naming it with the provided name
    const child = cp.spawn('cmd.exe', ['/c', 'start', `"${name}"`, 'cmd.exe', '/c', cmdStr], {
      cwd: dir,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch (err) {
    return false;
  }
}

function stopServer(port, windowTitle) {
  // First try to kill the window by title (kills the cmd and nodemon inside it)
  try {
    cp.execSync(`taskkill /FI "WINDOWTITLE eq ${windowTitle}*" /T /F`);
  } catch (e) {
    // Ignore error if window not found
  }
  
  // As a fallback, kill the node process listening on the port
  const pid = getPidByPort(port);
  if (pid) {
    try {
      cp.execSync(`taskkill /F /T /PID ${pid}`);
    } catch (err) {
      // Ignore
    }
  }
}

// Process commands from Chrome
function processCommand(msg) {
  if (!msg || !msg.command) return;

  const cmd = msg.command;
  let response = { type: 'result', command: cmd };

  if (cmd === 'status') {
    response.type = 'status';
    response.queueServerRunning = !!getPidByPort(8080);
    response.webConsoleRunning = !!getPidByPort(5173);
  } else if (cmd === 'start_queue') {
    if (!getPidByPort(8080)) {
      startServer('SOLOCoder-QueueServer', QUEUE_DIR, 'npm run dev');
    }
  } else if (cmd === 'stop_queue') {
    stopServer(8080, 'SOLOCoder-QueueServer');
  } else if (cmd === 'start_web') {
    if (!getPidByPort(5173)) {
      startServer('SOLOCoder-WebConsole', WEB_DIR, 'npm run dev');
    }
  } else if (cmd === 'stop_web') {
    stopServer(5173, 'SOLOCoder-WebConsole');
  }

  if (cmd !== 'status') {
    // Give it a moment to start/stop before returning status
    setTimeout(() => {
      sendMessage({
        type: 'status',
        queueServerRunning: !!getPidByPort(8080),
        webConsoleRunning: !!getPidByPort(5173)
      });
    }, 1500);
  } else {
    sendMessage(response);
  }
}

// Native Messaging stdin reader
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  
  // Read while we have enough data for a message
  while (buffer.length >= 4) {
    const msgLen = buffer.readUInt32LE(0);
    if (buffer.length >= 4 + msgLen) {
      const msgBuf = buffer.slice(4, 4 + msgLen);
      buffer = buffer.slice(4 + msgLen);
      try {
        const msg = JSON.parse(msgBuf.toString('utf8'));
        processCommand(msg);
      } catch (err) {
        sendMessage({ type: 'error', message: 'Failed to parse message: ' + err.message });
      }
    } else {
      break;
    }
  }
});
