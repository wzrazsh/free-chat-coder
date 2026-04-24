// /workspace/queue-server/index.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const setupWebSocket = require('./websocket/handler');
const taskRoutes = require('./routes/tasks');
const conversationRoutes = require('./routes/conversations');
const sharedConfig = require('../shared/config');

// 日志配置
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `queue-server-${new Date().toISOString().slice(0,10)}.log`);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 统一的日志写入函数（不使用被重写的 console）
function writeLog(level, message, ...args) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}\n`;

  // 输出到控制台（使用 process.stdout 避免递归）
  process.stdout.write(logLine);

  // 写入文件
  fs.appendFileSync(LOG_FILE, logLine);
}

// 重写 console 方法以捕获所有日志
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
let activePort = null;

console.log = (...args) => {
  originalLog.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog('INFO', msg);
};
console.error = (...args) => {
  originalError.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog('ERROR', msg);
};
console.warn = (...args) => {
  originalWarn.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog('WARN', msg);
};

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Basic health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: sharedConfig.queueServer.serviceName,
    port: activePort,
    preferredPort: sharedConfig.queueServer.preferredPort
  });
});

// Setup RESTful routes
app.use('/tasks', taskRoutes);
app.use('/conversations', conversationRoutes);

// Native Host installation endpoint
app.post('/install-native-host', (req, res) => {
  const { extensionId } = req.body;
  if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
    return res.status(400).json({ success: false, error: 'Invalid extension ID (must be 32 chars a-p)' });
  }

  const installScript = path.resolve(__dirname, '..', 'chromevideo', 'host', 'install_host.js');

  if (!fs.existsSync(installScript)) {
    return res.status(500).json({ success: false, error: `install_host.js not found at ${installScript}` });
  }

  execFile(process.execPath, [installScript, '--extension-id', extensionId], { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      return res.json({
        success: false,
        error: error.message || 'Installation script failed',
        stdout: (stdout || '').slice(-1000),
        stderr: (stderr || '').slice(-1000)
      });
    }

    res.json({
      success: true,
      message: 'Native Host installed successfully',
      stdout: (stdout || '').slice(-1000),
      stderr: (stderr || '').slice(-1000)
    });
  });
});

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Handler
setupWebSocket(server);

function probePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });

    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });

    probe.listen(port);
  });
}

async function findAvailablePort() {
  for (const candidatePort of sharedConfig.queueServer.portCandidates) {
    const available = await probePort(candidatePort);
    if (available) {
      return candidatePort;
    }

    console.warn(`[Queue-Server] Port ${candidatePort} is in use, trying next candidate...`);
  }

  throw new Error('No available queue-server port found.');
}

async function startServer() {
  activePort = await findAvailablePort();
  process.env.PORT = String(activePort);
  process.env.QUEUE_PORT = String(activePort);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(activePort, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`[Queue-Server] HTTP Server listening on port ${activePort}`);
  if (activePort !== sharedConfig.queueServer.preferredPort) {
    console.warn(
      `[Queue-Server] Preferred port ${sharedConfig.queueServer.preferredPort} unavailable, using fallback port ${activePort}`
    );
  }
}

startServer().catch((error) => {
  console.error('[Queue-Server] Failed to start server:', error);
  process.exit(1);
});
