const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const providerRegistry = require('./providers');
const deepseekWebProvider = require('./providers/deepseek-web/client');

function writeAuthSnapshot(storePath) {
  fs.writeFileSync(storePath, JSON.stringify({
    savedAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    ready: true,
    auth: {
      userAgent: 'Fake Chromium UA',
      cookieHeader: 'ds_session=cookie-123',
      bearerToken: 'fake-bearer-token',
      pageUrl: 'https://chat.deepseek.com/'
    }
  }, null, 2), 'utf8');
}

async function createFakeChatServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let parsedBody = null;
      try {
        parsedBody = body ? JSON.parse(body) : null;
      } catch (error) {
        parsedBody = null;
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.url === '/missing') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      if (req.url !== '/api/chat' || req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unsupported route' }));
        return;
      }

      if (req.headers.authorization !== 'Bearer fake-bearer-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad authorization' }));
        return;
      }

      if (req.headers.cookie !== 'ds_session=cookie-123') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad cookie' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message\n');
      res.write('data: {"session_id":"session-1","message_id":"assistant-msg-1","delta":"Hello"}\n\n');
      res.write('data: {"delta":" world"}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-provider-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');

  try {
    const authInspection = deepseekWebProvider.inspectAuthState(storePath);
    assert.strictEqual(authInspection.ready, false);
    assert.deepStrictEqual(authInspection.missing, ['cookieHeader', 'bearerToken', 'userAgent']);
    assert.strictEqual(authInspection.storePath, storePath);

    assert.strictEqual(providerRegistry.getTaskProvider({ options: {} }), 'extension-dom');
    assert.strictEqual(providerRegistry.getTaskProvider({ options: { provider: 'deepseek-web' } }), 'deepseek-web');
    assert.strictEqual(
      providerRegistry.canDispatchTask({ options: { provider: 'extension-dom' } }, { extensionAvailable: false }),
      false
    );
    assert.strictEqual(
      providerRegistry.canDispatchTask(
        { options: { provider: 'deepseek-web' } },
        { extensionAvailable: false, deepseekWebBusy: false }
      ),
      true
    );
    assert.strictEqual(
      providerRegistry.canDispatchTask(
        { options: { provider: 'deepseek-web' } },
        { extensionAvailable: true, deepseekWebBusy: true }
      ),
      false
    );

    try {
      await providerRegistry.executeTask({
        id: 'task-deepseek-auth-missing',
        prompt: 'hello',
        options: {
          provider: 'deepseek-web',
          authStorePath: storePath
        }
      });
      assert.fail('Expected deepseek-web execution to fail without onboarding auth state.');
    } catch (error) {
      assert.strictEqual(error.code, 'DEEPSEEK_AUTH_REQUIRED');
      assert.ok(error.message.includes('scripts/onboard-deepseek-web.js'));
      assert.deepStrictEqual(error.details.missing, ['cookieHeader', 'bearerToken', 'userAgent']);
      assert.strictEqual(error.details.storePath, storePath);
    }

    writeAuthSnapshot(storePath);
    const fakeServer = await createFakeChatServer();

    try {
      const result = await providerRegistry.executeTask({
        id: 'task-deepseek-success',
        prompt: 'hello from queue-server',
        options: {
          provider: 'deepseek-web',
          authStorePath: storePath,
          deepseekWeb: {
            baseUrl: fakeServer.baseUrl,
            endpointPaths: ['/missing', '/api/chat'],
            timeoutMs: 2000
          }
        }
      });

      assert.strictEqual(result.text, 'Hello world');
      assert.strictEqual(result.providerSessionId, 'session-1');
      assert.strictEqual(result.providerParentMessageId, 'assistant-msg-1');
      assert.strictEqual(result.providerMessageId, 'assistant-msg-1');
      assert.strictEqual(result.endpointPath, '/api/chat');
      assert.strictEqual(result.responseMode, 'event-stream');
      assert.strictEqual(fakeServer.requests.length, 2);
      assert.strictEqual(fakeServer.requests[0].url, '/missing');
      assert.strictEqual(fakeServer.requests[1].url, '/api/chat');
      assert.strictEqual(fakeServer.requests[1].body.message, 'hello from queue-server');
      assert.strictEqual(fakeServer.requests[1].body.stream, true);
    } finally {
      await fakeServer.close();
    }

    console.log('PASS test-deepseek-provider');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
