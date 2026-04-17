const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.WORKSPACE_ROOT = __dirname;

const evolveExecutor = require('./queue-server/evolution/evolve-executor');
const { validationService } = require('./queue-server/test-validator/validation-service');
const { rollbackManager } = require('./queue-server/test-validator/rollback-manager');

const fixtureRelativePath = '__validation-fixture.js';
const fixturePath = path.join(__dirname, 'chromevideo', fixtureRelativePath);

async function run() {
  const originalExists = fs.existsSync(fixturePath);
  const originalContent = originalExists ? fs.readFileSync(fixturePath, 'utf8') : null;

  const restoreFixture = () => {
    if (originalExists) {
      fs.writeFileSync(fixturePath, originalContent, 'utf8');
      return;
    }

    if (fs.existsSync(fixturePath)) {
      fs.unlinkSync(fixturePath);
    }
  };

  try {
    fs.writeFileSync(fixturePath, 'module.exports = { version: 1 };\n', 'utf8');

    const successId = `test-success-${Date.now()}`;
    const successResult = await evolveExecutor.evolveExtension({
      file: fixtureRelativePath,
      code: 'module.exports = { version: 2 };\n',
      evolutionId: successId,
      riskLevel: 'low'
    });

    assert.strictEqual(successResult.success, true, 'Expected successful evolveExtension result');
    assert.match(fs.readFileSync(fixturePath, 'utf8'), /version: 2/, 'Fixture should contain updated content');

    let latestStatus = validationService.getLatestEvolutionStatus();
    assert(latestStatus, 'Expected persisted validation status after successful evolution');
    assert.strictEqual(latestStatus.evolutionId, successId, 'Latest validation status should match successful evolution');
    assert.strictEqual(latestStatus.success, true, 'Successful evolution should be marked successful');
    assert.strictEqual(latestStatus.preflight.success, true, 'Successful evolution should pass preflight validation');
    assert.strictEqual(latestStatus.postChange.success, true, 'Successful evolution should pass post-change validation');

    fs.writeFileSync(fixturePath, 'module.exports = ;\n', 'utf8');

    const preflightId = `test-preflight-${Date.now()}`;
    const preflightResult = await evolveExecutor.evolveExtension({
      file: fixtureRelativePath,
      code: 'module.exports = { version: 3 };\n',
      evolutionId: preflightId,
      riskLevel: 'low'
    });

    assert.strictEqual(preflightResult.success, false, 'Preflight should block evolution when baseline file is already broken');
    assert.match(preflightResult.error, /Preflight validation failed/i, 'Preflight failure should explain why the write was blocked');
    assert.strictEqual(fs.readFileSync(fixturePath, 'utf8'), 'module.exports = ;\n', 'Preflight failure must not overwrite the existing file');

    latestStatus = validationService.getLatestEvolutionStatus();
    assert.strictEqual(latestStatus.evolutionId, preflightId, 'Latest validation status should match blocked evolution');
    assert.strictEqual(latestStatus.success, false, 'Blocked evolution should be marked unsuccessful');
    assert.strictEqual(latestStatus.blocked, true, 'Blocked evolution should record preflight block state');
    assert.strictEqual(latestStatus.preflight.success, false, 'Blocked evolution should expose failed preflight');

    fs.writeFileSync(fixturePath, 'module.exports = { version: 4 };\n', 'utf8');

    const rollbackId = `test-rollback-${Date.now()}`;
    const rollbackResult = await evolveExecutor.evolveExtension({
      file: fixtureRelativePath,
      code: 'module.exports = { version: 5 };\n// 请在现有 content.js 中手动合并以下改动\n',
      evolutionId: rollbackId,
      riskLevel: 'low'
    });

    assert.strictEqual(rollbackResult.success, false, 'Invalid generated content should fail validation');
    assert.match(rollbackResult.error, /rolled back/i, 'Rollback failure should describe the rollback outcome');
    assert.match(fs.readFileSync(fixturePath, 'utf8'), /version: 4/, 'Failed evolution should roll the file back to the previous content');

    latestStatus = validationService.getLatestEvolutionStatus();
    assert.strictEqual(latestStatus.evolutionId, rollbackId, 'Latest validation status should match rolled back evolution');
    assert.strictEqual(latestStatus.success, false, 'Rolled back evolution should be marked unsuccessful');
    assert.strictEqual(latestStatus.postChange.success, false, 'Rolled back evolution should expose failed post-change validation');
    assert.strictEqual(latestStatus.rollback.attempted, true, 'Rolled back evolution should record rollback attempt');
    assert.strictEqual(latestStatus.rollback.success, true, 'Rollback attempt should succeed');

    fs.writeFileSync(fixturePath, 'module.exports = { version: 6 };\n', 'utf8');

    const originalRollback = rollbackManager.rollback;
    const rollbackFailureId = `test-rollback-failure-${Date.now()}`;

    try {
      rollbackManager.rollback = async () => ({
        success: false,
        error: 'Simulated rollback failure'
      });

      const rollbackFailureResult = await evolveExecutor.evolveExtension({
        file: fixtureRelativePath,
        code: 'module.exports = { version: 7 };\n// 请在现有 content.js 中手动合并以下改动\n',
        evolutionId: rollbackFailureId,
        riskLevel: 'low'
      });

      assert.strictEqual(rollbackFailureResult.success, false, 'Rollback failure should still fail the evolution');
      assert.match(rollbackFailureResult.error, /rollback failed/i, 'Rollback failure should be called out explicitly');
      assert.match(rollbackFailureResult.error, /Simulated rollback failure/, 'Rollback failure should include the underlying rollback error');
      assert.match(fs.readFileSync(fixturePath, 'utf8'), /version: 7/, 'When rollback fails the candidate content should remain for diagnosis');

      latestStatus = validationService.getLatestEvolutionStatus();
      assert.strictEqual(latestStatus.evolutionId, rollbackFailureId, 'Latest validation status should match rollback failure evolution');
      assert.strictEqual(latestStatus.success, false, 'Rollback failure evolution should be marked unsuccessful');
      assert.strictEqual(latestStatus.postChange.success, false, 'Rollback failure should still expose the failed post-change validation');
      assert.strictEqual(latestStatus.rollback.attempted, true, 'Rollback failure should record that rollback was attempted');
      assert.strictEqual(latestStatus.rollback.success, false, 'Rollback failure should be recorded explicitly');
      assert.match(latestStatus.summary, /Rollback failed/i, 'Rollback failure should be reflected in the audit summary');
    } finally {
      rollbackManager.rollback = originalRollback;
      rollbackManager.discard(rollbackFailureId);
    }

    rollbackManager.discard(successId);
    rollbackManager.discard(rollbackId);

    console.log('Evolution validation flow passed.');
  } finally {
    restoreFixture();
  }
}

run().catch((error) => {
  console.error('Evolution validation flow failed:', error);
  process.exit(1);
});
