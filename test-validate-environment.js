const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDeepSeekWebDiagnostics } = require('./validate-environment');

function getCheck(section, name) {
  const check = section.checks.find((entry) => entry.name === name);
  assert.ok(check, `Missing check: ${name}`);
  return check;
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-validate-env-'));
  const repoRoot = tempDir;
  const effectiveProfile = path.join(repoRoot, '.browser-profile');
  const storePath = path.join(repoRoot, 'queue-server', 'data', 'deepseek-web-auth.json');

  try {
    fs.mkdirSync(effectiveProfile, { recursive: true });
    fs.mkdirSync(path.dirname(storePath), { recursive: true });

    const missingSection = await collectDeepSeekWebDiagnostics({
      repoRoot,
      effectiveProfile,
      inspectAuthStateFn: () => ({
        ready: false,
        storePath,
        reason: 'missing_snapshot',
        missing: ['cookieHeader', 'bearerToken', 'userAgent'],
        capturedAt: null,
        pageUrl: null,
        profilePath: null
      }),
      captureAuthStateFn: async () => ({
        ok: false,
        issues: [
          `DevToolsActivePort file is missing: ${path.join(effectiveProfile, 'DevToolsActivePort')}`,
          'No open page target matched https://chat.deepseek.com/.'
        ],
        recommendations: [
          `Start Chromium with --remote-debugging-port=0 --user-data-dir=${effectiveProfile}.`
        ],
        debug: {
          devToolsReachable: false,
          devToolsActivePort: {
            filePath: path.join(effectiveProfile, 'DevToolsActivePort'),
            port: null
          },
          browserVersion: null,
          targetCount: 0,
          deepseekTarget: null
        },
        auth: {
          userAgent: null,
          cookieHeader: null,
          cookies: [],
          bearerToken: null,
          bearerSource: null,
          pageUrl: null
        }
      })
    });

    assert.strictEqual(missingSection.title, 'DeepSeek Web');
    assert.strictEqual(getCheck(missingSection, 'Auth snapshot').status, 'warn');
    assert.ok(getCheck(missingSection, 'Auth snapshot').value.includes('Not onboarded'));
    assert.strictEqual(getCheck(missingSection, 'Auth snapshot profile').status, 'info');
    assert.strictEqual(getCheck(missingSection, 'Debug browser attach').status, 'warn');
    assert.strictEqual(getCheck(missingSection, 'Live auth capture').status, 'warn');
    assert.ok(getCheck(missingSection, 'Live auth capture').value.includes('cookieHeader'));
    assert.ok(
      getCheck(missingSection, 'Live auth capture').fixes.some((step) => step.includes('onboard-deepseek-web.js'))
    );

    const readySection = await collectDeepSeekWebDiagnostics({
      repoRoot,
      effectiveProfile,
      inspectAuthStateFn: () => ({
        ready: true,
        storePath,
        reason: null,
        missing: [],
        capturedAt: '2026-04-17T12:34:56.000Z',
        pageUrl: 'https://chat.deepseek.com/a/chat-session',
        profilePath: effectiveProfile
      }),
      captureAuthStateFn: async () => ({
        ok: true,
        issues: [],
        recommendations: [],
        debug: {
          devToolsReachable: true,
          devToolsActivePort: {
            filePath: path.join(effectiveProfile, 'DevToolsActivePort'),
            port: 9222
          },
          browserVersion: 'Chrome/136.0.0.0',
          targetCount: 3,
          deepseekTarget: {
            url: 'https://chat.deepseek.com/a/chat-session'
          }
        },
        auth: {
          userAgent: 'Mozilla/5.0 Test',
          cookieHeader: 'session=secret',
          cookies: [{ name: 'session', value: 'secret' }],
          bearerToken: 'secret-token',
          bearerSource: 'localStorage:session.accessToken',
          pageUrl: 'https://chat.deepseek.com/a/chat-session'
        }
      })
    });

    assert.strictEqual(getCheck(readySection, 'Auth snapshot').status, 'pass');
    assert.strictEqual(getCheck(readySection, 'Auth snapshot profile').status, 'pass');
    assert.strictEqual(getCheck(readySection, 'Debug browser attach').status, 'pass');
    assert.strictEqual(getCheck(readySection, 'Live auth capture').status, 'pass');
    assert.strictEqual(getCheck(readySection, 'Live auth capture').value, 'cookie / bearer / userAgent captured');

    console.log('PASS test-validate-environment');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
