const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'verify-deepseek-web-provider.js');

function writeAuthSnapshot(storePath, overrides = {}) {
  fs.writeFileSync(storePath, JSON.stringify({
    savedAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    ready: overrides.ready !== undefined ? overrides.ready : true,
    auth: {
      userAgent: 'Fake Chromium UA',
      cookieHeader: 'ds_session=cookie-123',
      bearerToken: 'fake-bearer-token',
      pageUrl: 'https://chat.deepseek.com/',
      ...(overrides.auth || {})
    },
    debug: {
      ...(overrides.debug || {})
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

      if (req.url !== '/api/chat' || req.method !== 'POST') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing route' }));
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

      if (req.headers['x-probe-mode'] !== 'cli-test') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing header' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"session_id":"probe-session-1","message_id":"probe-msg-1","delta":"Probe"}\n\n');
      res.write('data: {"delta":" ok"}\n\n');
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

async function createInvalidTokenServer() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 40003,
        msg: 'INVALID_TOKEN',
        data: null
      }));
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

function runProbe(args) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        status: code,
        signal,
        stdout,
        stderr
      });
    });
  });
}

async function runSuccessScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-probe-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');
  const requestBodyPath = path.join(tempDir, 'request-body.json');
  writeAuthSnapshot(storePath);
  fs.writeFileSync(requestBodyPath, JSON.stringify({
    stream: true,
    meta: {
      source: 'cli-test'
    }
  }, null, 2), 'utf8');
  const fakeServer = await createFakeChatServer();

  try {
    const probeResult = await runProbe([
      '--store-path',
      storePath,
      '--base-url',
      fakeServer.baseUrl,
      '--endpoint-path',
      '/api/chat',
      '--prompt',
      'Return a probe acknowledgment.',
      '--header',
      'X-Probe-Mode: cli-test',
      '--request-body',
      `@${path.relative(REPO_ROOT, requestBodyPath)}`,
      '--json'
    ]);

    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.auth.ready, true);
    assert.strictEqual(output.request.endpointPaths[0], '/api/chat');
    assert.ok(output.request.headerNames.includes('X-Probe-Mode'));
    assert.ok(output.request.requestBodyKeys.includes('stream'));
    assert.ok(output.request.requestBodyKeys.includes('meta'));
    assert.strictEqual(output.probe.endpointPath, '/api/chat');
    assert.strictEqual(output.probe.responseMode, 'event-stream');
    assert.strictEqual(output.probe.providerSessionId, 'probe-session-1');
    assert.strictEqual(output.probe.providerMessageId, 'probe-msg-1');
    assert.ok(output.probe.textPreview.includes('Probe ok'));

    assert.strictEqual(fakeServer.requests.length, 1);
    assert.strictEqual(fakeServer.requests[0].url, '/api/chat');
    assert.strictEqual(fakeServer.requests[0].headers['x-probe-mode'], 'cli-test');
    assert.strictEqual(fakeServer.requests[0].body.message, 'Return a probe acknowledgment.');
    assert.strictEqual(fakeServer.requests[0].body.stream, true);
    assert.strictEqual(fakeServer.requests[0].body.meta.source, 'cli-test');
  } finally {
    await fakeServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runMissingAuthScenario() {
  const missingStorePath = path.join(REPO_ROOT, 'queue-server', 'data', `missing-auth-${Date.now()}.json`);
  return runProbe([
    '--store-path',
    path.relative(REPO_ROOT, missingStorePath),
    '--json'
  ]).then((probeResult) => {
    assert.notStrictEqual(probeResult.status, 0, probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.auth.ready, false);
    assert.strictEqual(output.probe.ok, false);
    assert.strictEqual(output.probe.error.code, 'DEEPSEEK_AUTH_REQUIRED');
    assert.ok(output.nextSteps.some((step) => step.includes('onboard-deepseek-web.js')));
  });
}

async function runChallengeAuthScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-probe-challenge-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');
  writeAuthSnapshot(storePath, {
    auth: {
      bearerSource: 'localStorage:localStorage.aws_waf_token_challenge_attempts'
    },
    debug: {
      challengeDetected: true,
      challengeReason: 'max_challenge_attempts_exceeded'
    }
  });

  try {
    const probeResult = await runProbe([
      '--store-path',
      storePath,
      '--json'
    ]);

    assert.notStrictEqual(probeResult.status, 0, probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.auth.ready, false);
    assert.strictEqual(output.auth.reason, 'challenge_page');
    assert.strictEqual(output.auth.challengeReason, 'max_challenge_attempts_exceeded');
    assert.strictEqual(output.probe.ok, false);
    assert.strictEqual(output.probe.error.code, 'DEEPSEEK_AUTH_CHALLENGED');
    assert.ok(output.nextSteps.some((step) => step.includes('AWS WAF challenge page')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runLoggedOutAuthScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-probe-logged-out-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');
  writeAuthSnapshot(storePath, {
    auth: {
      bearerSource: 'localStorage:localStorage.userToken',
      pageUrl: 'https://chat.deepseek.com/sign_in'
    },
    debug: {
      authPageDetected: true,
      authPageReason: 'auth_path:/sign_in'
    }
  });

  try {
    const probeResult = await runProbe([
      '--store-path',
      storePath,
      '--json'
    ]);

    assert.notStrictEqual(probeResult.status, 0, probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.auth.ready, false);
    assert.strictEqual(output.auth.reason, 'logged_out');
    assert.strictEqual(output.auth.authPageReason, 'auth_path:/sign_in');
    assert.strictEqual(output.probe.ok, false);
    assert.strictEqual(output.probe.error.code, 'DEEPSEEK_AUTH_LOGGED_OUT');
    assert.ok(output.nextSteps.some((step) => step.includes('sign-in page')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runTelemetryTokenScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-probe-telemetry-token-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');
  writeAuthSnapshot(storePath, {
    auth: {
      bearerSource: 'localStorage:localStorage.__tea_cache_tokens_20006317'
    }
  });

  try {
    const probeResult = await runProbe([
      '--store-path',
      storePath,
      '--json'
    ]);

    assert.notStrictEqual(probeResult.status, 0, probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.auth.ready, false);
    assert.strictEqual(output.auth.reason, 'telemetry_token');
    assert.strictEqual(output.probe.ok, false);
    assert.strictEqual(output.probe.error.code, 'DEEPSEEK_AUTH_TOKEN_SOURCE_INVALID');
    assert.ok(output.nextSteps.some((step) => step.includes('telemetry token')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runInvalidTokenScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-deepseek-probe-invalid-token-'));
  const storePath = path.join(tempDir, 'deepseek-web-auth.json');
  writeAuthSnapshot(storePath);
  const invalidTokenServer = await createInvalidTokenServer();

  try {
    const probeResult = await runProbe([
      '--store-path',
      storePath,
      '--base-url',
      invalidTokenServer.baseUrl,
      '--endpoint-path',
      '/api/chat',
      '--json'
    ]);

    assert.notStrictEqual(probeResult.status, 0, probeResult.stdout);

    const output = JSON.parse(probeResult.stdout);
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.auth.ready, true);
    assert.strictEqual(output.probe.ok, false);
    assert.strictEqual(output.probe.error.code, 'DEEPSEEK_AUTH_INVALID');
    assert.strictEqual(output.probe.error.reason, 'INVALID_TOKEN');
    assert.ok(output.nextSteps.some((step) => step.includes('captured token was rejected')));
  } finally {
    await invalidTokenServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await runSuccessScenario();
  await runMissingAuthScenario();
  await runChallengeAuthScenario();
  await runLoggedOutAuthScenario();
  await runTelemetryTokenScenario();
  await runInvalidTokenScenario();
  console.log('PASS test-deepseek-provider-probe');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
