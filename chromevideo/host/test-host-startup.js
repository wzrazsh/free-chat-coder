const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hostPath = path.join(__dirname, 'host.js');
const hostSource = `${fs.readFileSync(hostPath, 'utf8')}\n;globalThis.__hostTestExports = { processCommand, SERVICES };`;

function loadHostContext() {
  const context = {
    __dirname: path.dirname(hostPath),
    __filename: hostPath,
    Buffer,
    console,
    clearTimeout,
    setTimeout,
    global: null,
    globalThis: null,
    require(request) {
      if (request === 'child_process') {
        return {
          execFileSync() {
            throw new Error('Unexpected child_process.execFileSync call');
          },
          execSync() {
            throw new Error('Unexpected child_process.execSync call');
          },
          spawn() {
            throw new Error('Unexpected child_process.spawn call');
          }
        };
      }

      if (request === 'fs') {
        return {
          existsSync() {
            return true;
          },
          readFileSync() {
            return '{}';
          },
          writeFileSync() {}
        };
      }

      if (request === 'net') {
        return {
          createConnection() {
            throw new Error('Unexpected net.createConnection call');
          }
        };
      }

      if (request === '../../shared/config') {
        return {
          queueServer: {
            preferredPort: 8080,
            host: '127.0.0.1'
          }
        };
      }

      if (request === '../../shared/queue-server') {
        return {
          discoverQueueServer: async () => null
        };
      }

      return require(request);
    },
    process: {
      platform: 'linux',
      execPath: process.execPath,
      env: process.env,
      stdin: {
        on() {}
      },
      stdout: {
        write() {}
      },
      kill() {
        const error = new Error('Unexpected process.kill call');
        error.code = 'ESRCH';
        throw error;
      }
    }
  };

  context.global = context;
  context.globalThis = context;

  vm.runInNewContext(hostSource, context, { filename: hostPath });
  return context;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

async function testStartQueueReportsReadinessTimeout() {
  const context = loadHostContext();
  const sentMessages = [];

  context.getStatus = async () => ({
    queueServerRunning: false,
    queueServerPort: null,
    webConsoleRunning: true
  });
  context.hasLiveServiceProcess = () => false;
  context.startServer = () => ({ ok: true });
  context.waitForServiceState = async () => ({
    ok: false,
    waitedMs: 15000,
    status: {
      port: 8080,
      processAlive: true
    }
  });
  context.sendMessage = (message) => {
    sentMessages.push(message);
  };
  context.sendStatus = async () => {
    sentMessages.push({ type: 'status' });
  };

  await context.__hostTestExports.processCommand({ command: 'start_queue' });

  assert.deepStrictEqual(normalize(sentMessages), [
    {
      type: 'error',
      message: 'Queue Server did not become ready within 15s (port 8080; process is alive but not ready)'
    }
  ]);
}

async function testStartWebSendsStatusAfterReadiness() {
  const context = loadHostContext();
  const sentMessages = [];

  context.getStatus = async () => ({
    queueServerRunning: true,
    queueServerPort: 8080,
    webConsoleRunning: false
  });
  context.hasLiveServiceProcess = () => false;
  context.startServer = () => ({ ok: true });
  context.waitForServiceState = async () => ({
    ok: true,
    waitedMs: 1200,
    status: {
      port: 5173,
      processAlive: true
    }
  });
  context.sendMessage = (message) => {
    sentMessages.push(message);
  };
  context.sendStatus = async () => {
    sentMessages.push({ type: 'status' });
  };

  await context.__hostTestExports.processCommand({ command: 'start_web' });

  assert.deepStrictEqual(normalize(sentMessages), [{ type: 'status' }]);
}

async function main() {
  await testStartQueueReportsReadinessTimeout();
  await testStartWebSendsStatusAfterReadiness();
  console.log('host startup checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
