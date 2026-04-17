const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const providerRegistry = require('./providers');
const deepseekWebProvider = require('./providers/deepseek-web/client');

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

    console.log('PASS test-deepseek-provider');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
