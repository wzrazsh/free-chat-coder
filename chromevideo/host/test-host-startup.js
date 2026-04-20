const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hostPath = path.join(__dirname, 'host.js');
const pidFilePath = path.join(__dirname, '.service-pids.json');
const hostSource = `${fs.readFileSync(hostPath, 'utf8')}\n;globalThis.__hostTestExports = { processCommand, SERVICES };`;

function loadHostContext(options = {}) {
  const pidFileState = {
    text: options.pidFileData || '{}',
    writes: []
  };

  const childProcessMock = options.childProcess || {
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
        return childProcessMock;
      }

      if (request === 'fs') {
        return {
          existsSync() {
            return true;
          },
          readFileSync(filePath) {
            if (path.resolve(filePath) === pidFilePath) {
              return pidFileState.text;
            }
            return '{}';
          },
          writeFileSync(filePath, content) {
            if (path.resolve(filePath) === pidFilePath) {
              pidFileState.text = String(content);
              pidFileState.writes.push(String(content));
            }
          }
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
          discoverQueueServer: options.discoverQueueServer || (async () => null)
        };
      }

      return require(request);
    },
    process: {
      platform: options.platform || 'linux',
      execPath: process.execPath,
      env: process.env,
      stdin: {
        on() {}
      },
      stdout: {
        write() {}
      },
      kill: options.processKill || function() {
        const error = new Error('Unexpected process.kill call');
        error.code = 'ESRCH';
        throw error;
      }
    }
  };

  context.global = context;
  context.globalThis = context;

  vm.runInNewContext(hostSource, context, { filename: hostPath });
  context.__testState = { pidFileState };
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

async function testStartServerIgnoresStaleRecordedPid() {
  const alivePids = new Set([21416]);
  let spawnCalls = 0;

  const context = loadHostContext({
    pidFileData: JSON.stringify({
      'SOLOCoder-QueueServer': {
        pid: 43976,
        port: 8080,
        listenerPid: 21416
      }
    }),
    childProcess: {
      execFileSync(command, args) {
        if (command === 'ss') {
          return '';
        }

        if (command === 'ps') {
          const pid = Number(args[1]);
          if (pid === 21416) {
            return 'C:/Program Files/Trae CN/Trae CN.exe';
          }
          return '';
        }

        throw new Error(`Unexpected child_process.execFileSync call: ${command}`);
      },
      execSync() {
        throw new Error('Unexpected child_process.execSync call');
      },
      spawn() {
        spawnCalls += 1;
        return {
          pid: 55001,
          unref() {}
        };
      }
    },
    processKill(pid, signal) {
      if (signal === 0 && alivePids.has(pid)) {
        return;
      }

      const error = new Error('No such process');
      error.code = 'ESRCH';
      throw error;
    }
  });

  const result = context.startServer('SOLOCoder-QueueServer');

  assert.deepStrictEqual(normalize(result), { ok: true });
  assert.strictEqual(spawnCalls, 1);
  assert.deepStrictEqual(normalize(JSON.parse(context.__testState.pidFileState.text)), {
    'SOLOCoder-QueueServer': {
      pid: 55001,
      port: null,
      startedAt: JSON.parse(context.__testState.pidFileState.text)['SOLOCoder-QueueServer'].startedAt
    }
  });
}

async function testStopServerDoesNotKillUnrelatedRecordedPid() {
  const alivePids = new Set([21416]);
  const killedPids = [];

  const context = loadHostContext({
    pidFileData: JSON.stringify({
      'SOLOCoder-QueueServer': {
        pid: 43976,
        port: 8080,
        listenerPid: 21416
      }
    }),
    childProcess: {
      execFileSync(command, args) {
        if (command === 'ss') {
          return '';
        }

        if (command === 'ps') {
          const pid = Number(args[1]);
          if (pid === 21416) {
            return 'C:/Program Files/Trae CN/Trae CN.exe';
          }
          return '';
        }

        throw new Error(`Unexpected child_process.execFileSync call: ${command}`);
      },
      execSync(command) {
        if (command.startsWith('ps aux | grep -v grep | grep')) {
          throw new Error('no matches');
        }

        throw new Error(`Unexpected child_process.execSync call: ${command}`);
      },
      spawn() {
        throw new Error('Unexpected child_process.spawn call');
      }
    },
    processKill(pid, signal) {
      if (signal === 0 && alivePids.has(pid)) {
        return;
      }

      if (signal === 'SIGKILL') {
        killedPids.push(pid);
        alivePids.delete(pid);
        return;
      }

      const error = new Error('No such process');
      error.code = 'ESRCH';
      throw error;
    }
  });

  context.sleep = async () => {};
  const result = await context.stopServer('SOLOCoder-QueueServer');

  assert.deepStrictEqual(normalize(result), {
    killedPids: [],
    port: 8080
  });
  assert.deepStrictEqual(killedPids, []);
  assert.deepStrictEqual(normalize(JSON.parse(context.__testState.pidFileState.text)), {});
}

async function main() {
  await testStartQueueReportsReadinessTimeout();
  await testStartWebSendsStatusAfterReadiness();
  await testStartServerIgnoresStaleRecordedPid();
  await testStopServerDoesNotKillUnrelatedRecordedPid();
  console.log('host startup checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
