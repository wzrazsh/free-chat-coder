const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { WebSocketServer } = require('./queue-server/node_modules/ws');
const {
  captureAuthState,
  loadAuthState,
  saveAuthState,
  summarizeCapture
} = require('./queue-server/providers/deepseek-web/auth');

async function createFakeDevToolsServer(options = {}) {
  const pageState = options.pageState || {
    href: 'https://chat.deepseek.com/',
    title: 'DeepSeek Chat',
    origin: 'https://chat.deepseek.com',
    userAgent: 'Fake Chromium UA',
    localStorageKeys: ['accessToken'],
    sessionStorageKeys: [],
    tokenCandidates: [{
      source: 'localStorage',
      keyPath: 'localStorage.accessToken',
      value: 'Bearer fake-bearer-token',
      valueLength: 24
    }]
  };
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        Browser: 'Chrome/136.0.0.0',
        'User-Agent': 'Fake Chromium UA',
        webSocketDebuggerUrl: `ws://127.0.0.1:${httpServer.address().port}/devtools/browser/browser-1`
      }));
      return;
    }

    if (req.url === '/json/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{
        id: 'page-1',
        type: 'page',
        title: 'DeepSeek Chat',
        url: 'https://chat.deepseek.com/',
        webSocketDebuggerUrl: `ws://127.0.0.1:${httpServer.address().port}/devtools/page/page-1`
      }]));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const browserSockets = new WebSocketServer({ noServer: true });
  const pageSockets = new WebSocketServer({ noServer: true });

  browserSockets.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));

      if (message.method === 'Storage.getCookies' || message.method === 'Network.getAllCookies') {
        socket.send(JSON.stringify({
          id: message.id,
          result: {
            cookies: [
              {
                name: 'ds_session',
                value: 'cookie-123',
                domain: '.deepseek.com',
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'Lax',
                expires: -1
              },
              {
                name: 'analytics',
                value: 'ignore-me',
                domain: '.example.com',
                path: '/',
                secure: false,
                httpOnly: false,
                sameSite: 'Lax',
                expires: -1
              }
            ]
          }
        }));
      }
    });
  });

  pageSockets.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));

      if (message.method === 'Runtime.enable') {
        socket.send(JSON.stringify({
          id: message.id,
          result: {}
        }));
        return;
      }

      if (message.method === 'Runtime.evaluate') {
        socket.send(JSON.stringify({
          id: message.id,
          result: {
            result: {
              type: 'object',
              value: pageState
            }
          }
        }));
      }
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url === '/devtools/browser/browser-1') {
      browserSockets.handleUpgrade(request, socket, head, (ws) => {
        browserSockets.emit('connection', ws, request);
      });
      return;
    }

    if (request.url === '/devtools/page/page-1') {
      pageSockets.handleUpgrade(request, socket, head, (ws) => {
        pageSockets.emit('connection', ws, request);
      });
      return;
    }

    socket.destroy();
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const port = httpServer.address().port;

  return {
    port,
    async close() {
      await new Promise((resolve) => browserSockets.close(resolve));
      await new Promise((resolve) => pageSockets.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    }
  };
}

function createTempProfile() {
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-web-auth-'));
  fs.writeFileSync(path.join(profilePath, 'DevToolsActivePort'), '0\n/devtools/browser/browser-1\n', 'utf8');
  return profilePath;
}

async function testCaptureAuthStateFromFakeDevTools() {
  const server = await createFakeDevToolsServer();
  const profilePath = createTempProfile();
  const devToolsPath = path.join(profilePath, 'DevToolsActivePort');
  fs.writeFileSync(devToolsPath, `${server.port}\n/devtools/browser/browser-1\n`, 'utf8');

  try {
    const capture = await captureAuthState({
      profilePath,
      origin: 'https://chat.deepseek.com/'
    });

    assert.strictEqual(capture.ok, true);
    assert.strictEqual(capture.auth.userAgent, 'Fake Chromium UA');
    assert.strictEqual(capture.auth.cookieHeader, 'ds_session=cookie-123');
    assert.strictEqual(capture.auth.bearerToken, 'fake-bearer-token');
    assert.strictEqual(capture.auth.bearerSource, 'localStorage:localStorage.accessToken');
    assert.strictEqual(capture.debug.deepseekTarget.url, 'https://chat.deepseek.com/');
    assert.strictEqual(capture.auth.cookies.length, 1);

    const summary = summarizeCapture(capture, {
      storePath: path.join(profilePath, 'deepseek-web-auth.json')
    });
    assert.strictEqual(summary.auth.cookieCount, 1);
    assert.strictEqual(summary.auth.cookieHeader.present, true);
    assert.strictEqual(summary.auth.bearerToken.present, true);
    assert.strictEqual(summary.auth.cookieHeader.length > 0, true);
    assert.strictEqual(summary.auth.cookieHeader.fingerprint.length, 12);

    const storePath = path.join(profilePath, 'deepseek-web-auth.json');
    saveAuthState(capture, { storePath });
    const persisted = loadAuthState({ storePath });
    assert.strictEqual(persisted.ready, true);
    assert.strictEqual(persisted.auth.bearerToken, 'fake-bearer-token');
    assert.strictEqual(persisted.auth.cookieHeader, 'ds_session=cookie-123');
  } finally {
    fs.rmSync(profilePath, { recursive: true, force: true });
    await server.close();
  }
}

async function testCaptureHandlesStaleDebuggerPort() {
  const profilePath = createTempProfile();
  fs.writeFileSync(path.join(profilePath, 'DevToolsActivePort'), '65534\n/devtools/browser/browser-1\n', 'utf8');

  try {
    const capture = await captureAuthState({
      profilePath,
      origin: 'https://chat.deepseek.com/'
    });

    assert.strictEqual(capture.ok, false);
    assert.strictEqual(capture.debug.devToolsReachable, false);
    assert(capture.issues.some((issue) => issue.includes('DevTools endpoint is not reachable')));
  } finally {
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

async function testCaptureRejectsTelemetryConfigCandidate() {
  const server = await createFakeDevToolsServer({
    pageState: {
      href: 'https://chat.deepseek.com/',
      title: 'DeepSeek Chat',
      origin: 'https://chat.deepseek.com',
      userAgent: 'Fake Chromium UA',
      localStorageKeys: ['APMPLUS__cache__server__config__675113'],
      sessionStorageKeys: [],
      tokenCandidates: [{
        source: 'localStorage',
        keyPath: 'localStorage.APMPLUS__cache__server__config__675113.sample.sample_granularity',
        value: 'default',
        valueLength: 7
      }]
    }
  });
  const profilePath = createTempProfile();
  const devToolsPath = path.join(profilePath, 'DevToolsActivePort');
  fs.writeFileSync(devToolsPath, `${server.port}\n/devtools/browser/browser-1\n`, 'utf8');

  try {
    const capture = await captureAuthState({
      profilePath,
      origin: 'https://chat.deepseek.com/'
    });

    assert.strictEqual(capture.ok, false);
    assert.strictEqual(capture.auth.cookieHeader, 'ds_session=cookie-123');
    assert.strictEqual(capture.auth.bearerToken, null);
    assert.strictEqual(capture.auth.bearerSource, null);
    assert.ok(capture.issues.some((issue) => issue.includes('Rejected telemetry-like bearer candidate')));
    assert.ok(capture.issues.some((issue) => issue.includes('No bearer-like token could be found')));
  } finally {
    fs.rmSync(profilePath, { recursive: true, force: true });
    await server.close();
  }
}

async function testCaptureRejectsWeakSessionMetadataCandidate() {
  const server = await createFakeDevToolsServer({
    pageState: {
      href: 'https://chat.deepseek.com/',
      title: 'DeepSeek Chat',
      origin: 'https://chat.deepseek.com',
      userAgent: 'Fake Chromium UA',
      localStorageKeys: ['__appKit_@deepseek/chat_lastSessionValue'],
      sessionStorageKeys: [],
      tokenCandidates: [{
        source: 'localStorage',
        keyPath: 'localStorage.__appKit_@deepseek/chat_lastSessionValue.value.loginMethod',
        value: 'sms',
        valueLength: 3
      }]
    }
  });
  const profilePath = createTempProfile();
  const devToolsPath = path.join(profilePath, 'DevToolsActivePort');
  fs.writeFileSync(devToolsPath, `${server.port}\n/devtools/browser/browser-1\n`, 'utf8');

  try {
    const capture = await captureAuthState({
      profilePath,
      origin: 'https://chat.deepseek.com/'
    });

    assert.strictEqual(capture.ok, false);
    assert.strictEqual(capture.auth.cookieHeader, 'ds_session=cookie-123');
    assert.strictEqual(capture.auth.bearerToken, null);
    assert.strictEqual(capture.auth.bearerSource, null);
    assert.ok(capture.issues.some((issue) => issue.includes('No bearer-like token could be found')));
  } finally {
    fs.rmSync(profilePath, { recursive: true, force: true });
    await server.close();
  }
}

async function testCaptureRejectsTeaSessionTelemetryCandidate() {
  const server = await createFakeDevToolsServer({
    pageState: {
      href: 'https://chat.deepseek.com/',
      title: 'DeepSeek Chat',
      origin: 'https://chat.deepseek.com',
      userAgent: 'Fake Chromium UA',
      localStorageKeys: [],
      sessionStorageKeys: ['__tea_session_id_20006317'],
      tokenCandidates: [{
        source: 'sessionStorage',
        keyPath: 'sessionStorage.__tea_session_id_20006317.sessionId',
        value: '550e8400-e29b-41d4-a716-446655440000',
        valueLength: 36
      }]
    }
  });
  const profilePath = createTempProfile();
  const devToolsPath = path.join(profilePath, 'DevToolsActivePort');
  fs.writeFileSync(devToolsPath, `${server.port}\n/devtools/browser/browser-1\n`, 'utf8');

  try {
    const capture = await captureAuthState({
      profilePath,
      origin: 'https://chat.deepseek.com/'
    });

    assert.strictEqual(capture.ok, false);
    assert.strictEqual(capture.auth.cookieHeader, 'ds_session=cookie-123');
    assert.strictEqual(capture.auth.bearerToken, null);
    assert.strictEqual(capture.auth.bearerSource, null);
    assert.ok(capture.issues.some((issue) => issue.includes('Rejected telemetry-like bearer candidate')));
  } finally {
    fs.rmSync(profilePath, { recursive: true, force: true });
    await server.close();
  }
}

async function main() {
  await testCaptureAuthStateFromFakeDevTools();
  await testCaptureHandlesStaleDebuggerPort();
  await testCaptureRejectsTelemetryConfigCandidate();
  await testCaptureRejectsWeakSessionMetadataCandidate();
  await testCaptureRejectsTeaSessionTelemetryCandidate();
  console.log('deepseek-web auth checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
