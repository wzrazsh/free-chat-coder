const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const EXTENSION_DIR = path.join(WORKSPACE_ROOT, 'chromevideo');
const SERVER_DIR = path.join(WORKSPACE_ROOT, 'queue-server');

function checkSyntax(code) {
  try {
    new vm.Script(code);
    return true;
  } catch (error) {
    return error.message;
  }
}

function backupAndWrite(targetPath, code) {
  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, `${targetPath}.bak`);
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  fs.writeFileSync(targetPath, code, 'utf8');
}

function getValidationServiceModule() {
  try {
    const validatorPath = path.join(SERVER_DIR, 'test-validator', 'validation-service.js');
    if (fs.existsSync(validatorPath)) {
      return require(validatorPath);
    }
  } catch (error) {
    console.warn('[EvolveExecutor] Validation service not available:', error.message);
  }

  return null;
}

function getRollbackManagerModule() {
  try {
    const rollbackPath = path.join(SERVER_DIR, 'test-validator', 'rollback-manager.js');
    if (fs.existsSync(rollbackPath)) {
      return require(rollbackPath);
    }
  } catch (error) {
    console.warn('[EvolveExecutor] Rollback manager not available:', error.message);
  }

  return null;
}

function toWorkspaceRelative(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath).replace(/\\/g, '/');
}

function shouldCheckSyntax(targetPath) {
  return ['.js', '.cjs', '.mjs'].includes(path.extname(targetPath).toLowerCase());
}

const evolveExecutor = {
  _evolutionContext: null,

  setEvolutionContext(context) {
    this._evolutionContext = {
      evolutionId: context.evolutionId || `evolve-${Date.now()}`,
      action: context.action,
      riskLevel: context.riskLevel || 'low',
      targetPath: context.targetPath || null,
      targetRelativePath: context.targetPath ? toWorkspaceRelative(context.targetPath) : null,
      targetExisted: context.targetExisted !== false,
      startedAt: new Date().toISOString()
    };
  },

  getEvolutionContext() {
    return this._evolutionContext;
  },

  clearEvolutionContext() {
    this._evolutionContext = null;
  },

  async runValidationHook(action, options = {}) {
    const validationServiceModule = getValidationServiceModule();
    const validationService = validationServiceModule?.validationService;

    if (!validationService) {
      console.log('[EvolveExecutor] Validation service not available, skipping validation');
      return {
        success: true,
        skipped: true,
        reason: 'Validation service not available'
      };
    }

    const context = this._evolutionContext || {};
    const evolutionId = options.evolutionId || context.evolutionId || `evolve-${Date.now()}`;

    console.log(`[EvolveExecutor] Running ${options.phase || 'post_change'} validation for ${evolutionId}`);

    try {
      return await validationService.runP0Validation({
        evolutionId,
        action,
        riskLevel: context.riskLevel || 'low',
        targetPath: options.targetPath || context.targetPath,
        phase: options.phase || 'post_change',
        testSpecific: true
      });
    } catch (error) {
      console.error('[EvolveExecutor] Validation hook error:', error.message);
      return {
        success: false,
        evolutionId,
        action,
        phase: options.phase || 'post_change',
        error: error.message
      };
    }
  },

  async performRollback(evolutionId, options = {}) {
    const rollbackManager = getRollbackManagerModule()?.rollbackManager;
    let rollbackResult = null;

    if (rollbackManager) {
      rollbackResult = await rollbackManager.rollback(evolutionId);
    } else {
      rollbackResult = {
        success: false,
        error: 'Rollback manager not available'
      };
    }

    if (options.targetExisted === false && options.targetPath && fs.existsSync(options.targetPath)) {
      fs.unlinkSync(options.targetPath);
      rollbackResult = {
        ...rollbackResult,
        success: true,
        createdFileRemoved: true
      };
    }

    return rollbackResult;
  },

  discardRollbackArtifacts(evolutionId) {
    const rollbackManager = getRollbackManagerModule()?.rollbackManager;
    if (rollbackManager && typeof rollbackManager.discard === 'function') {
      rollbackManager.discard(evolutionId);
    }
  },

  createRollbackBackup(targetPath, evolutionId) {
    const rollbackManager = getRollbackManagerModule()?.rollbackManager;
    if (!rollbackManager || !fs.existsSync(targetPath)) {
      return null;
    }

    return rollbackManager.createBackup(targetPath, evolutionId);
  },

  recordEvolutionStatus(status) {
    const validationService = getValidationServiceModule()?.validationService;
    if (validationService && typeof validationService.recordEvolutionStatus === 'function') {
      validationService.recordEvolutionStatus(status);
    }
  },

  buildAudit(targetPath) {
    const context = this._evolutionContext || {};

    return {
      evolutionId: context.evolutionId,
      action: context.action,
      riskLevel: context.riskLevel || 'low',
      targetPath,
      targetRelativePath: toWorkspaceRelative(targetPath),
      startedAt: context.startedAt || new Date().toISOString(),
      success: false,
      blocked: false,
      candidate: null,
      preflight: null,
      postChange: null,
      rollback: {
        attempted: false,
        success: null
      }
    };
  },

  summarizeValidation(validationResult) {
    if (!validationResult) {
      return null;
    }

    const failedChecks = (validationResult.testResults || [])
      .filter((result) => result.status === 'failed' || result.status === 'error')
      .map((result) => ({
        name: result.name,
        targetPath: result.targetPath ? toWorkspaceRelative(result.targetPath) : null,
        command: result.command,
        error: result.error,
        reason: result.details?.reason || null
      }));

    return {
      success: !!validationResult.success,
      phase: validationResult.phase || null,
      decision: validationResult.decision?.action || null,
      reason: validationResult.decision?.reason || validationResult.error || validationResult.reason || null,
      checkCount: validationResult.testResults?.length || 0,
      reportPath: validationResult.reportPath ? toWorkspaceRelative(validationResult.reportPath) : null,
      failedChecks
    };
  },

  summarizeRollback(rollbackResult) {
    if (!rollbackResult) {
      return {
        attempted: false,
        success: null
      };
    }

    return {
      attempted: true,
      success: !!rollbackResult.success,
      error: rollbackResult.error || null,
      createdFileRemoved: !!rollbackResult.createdFileRemoved,
      results: rollbackResult.results || []
    };
  },

  buildRollbackFailure(errorMessage, rollbackSummary, fallbackMessage) {
    const rollbackError = rollbackSummary?.error || fallbackMessage || 'Unknown rollback error';

    return {
      error: `${errorMessage} Rollback failed: ${rollbackError}`,
      summary: `${errorMessage} Rollback failed: ${rollbackError}`
    };
  },

  async applyCodeChange({ action, targetPath, code, riskLevel, evolutionId, successResponse }) {
    if (!code) {
      return { success: false, error: 'Missing code parameter' };
    }

    const effectiveEvolutionId = evolutionId || `evolve-${Date.now()}`;
    const targetExisted = fs.existsSync(targetPath);

    this.setEvolutionContext({
      evolutionId: effectiveEvolutionId,
      action,
      riskLevel,
      targetPath,
      targetExisted
    });

    const audit = this.buildAudit(targetPath);
    let wroteCandidate = false;

    try {
      if (shouldCheckSyntax(targetPath)) {
        const syntaxCheck = checkSyntax(code);
        audit.candidate = {
          success: syntaxCheck === true,
          reason: syntaxCheck === true ? 'Candidate syntax check passed' : `Syntax Error: ${syntaxCheck}`
        };

        if (syntaxCheck !== true) {
          audit.completedAt = new Date().toISOString();
          audit.summary = 'Candidate syntax check failed before writing the change.';
          this.recordEvolutionStatus(audit);

          return {
            success: false,
            error: `Syntax Error: ${syntaxCheck}`,
            audit
          };
        }
      } else {
        audit.candidate = {
          success: true,
          reason: 'Candidate syntax check not required for this file type'
        };
      }

      let preflightResult = null;
      if (targetExisted) {
        preflightResult = await this.runValidationHook(action, {
          targetPath,
          phase: 'preflight',
          evolutionId: effectiveEvolutionId
        });
        audit.preflight = this.summarizeValidation(preflightResult);

        if (!preflightResult.success) {
          audit.blocked = true;
          audit.completedAt = new Date().toISOString();
          audit.summary = 'Preflight validation failed. Change was not written.';
          this.recordEvolutionStatus(audit);

          return {
            success: false,
            error: `Preflight validation failed for ${audit.targetRelativePath}`,
            validation: preflightResult,
            audit
          };
        }
      } else {
        audit.preflight = {
          success: true,
          phase: 'preflight',
          reason: 'Target file does not exist yet. Preflight validation skipped.'
        };
      }

      if (targetExisted) {
        this.createRollbackBackup(targetPath, effectiveEvolutionId);
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      }

      fs.writeFileSync(targetPath, code, 'utf8');
      wroteCandidate = true;

      const postChangeResult = await this.runValidationHook(action, {
        targetPath,
        phase: 'post_change',
        evolutionId: effectiveEvolutionId
      });
      audit.postChange = this.summarizeValidation(postChangeResult);

      if (!postChangeResult.success) {
        const rollbackResult = await this.performRollback(effectiveEvolutionId, {
          targetPath,
          targetExisted
        });
        audit.rollback = this.summarizeRollback(rollbackResult);
        audit.completedAt = new Date().toISOString();
        const validationFailureMessage = `${action} failed post-change validation.`;

        if (audit.rollback.success) {
          audit.summary = 'Post-change validation failed. Change was rolled back.';
        } else {
          const rollbackFailure = this.buildRollbackFailure(
            validationFailureMessage,
            audit.rollback,
            'Validation failed after writing the candidate change.'
          );
          audit.summary = rollbackFailure.summary;
        }

        this.recordEvolutionStatus(audit);

        return {
          success: false,
          error: audit.rollback.success
            ? `${action} failed validation and was rolled back`
            : this.buildRollbackFailure(
              validationFailureMessage,
              audit.rollback,
              'Validation failed after writing the candidate change.'
            ).error,
          validation: postChangeResult,
          rollback: rollbackResult,
          audit
        };
      }

      this.discardRollbackArtifacts(effectiveEvolutionId);
      audit.success = true;
      audit.completedAt = new Date().toISOString();
      audit.summary = 'Preflight and post-change validation both passed.';
      this.recordEvolutionStatus(audit);

      return {
        ...successResponse,
        validation: postChangeResult,
        audit
      };
    } catch (error) {
      if (wroteCandidate) {
        const rollbackResult = await this.performRollback(effectiveEvolutionId, {
          targetPath,
          targetExisted
        });
        audit.rollback = this.summarizeRollback(rollbackResult);

        if (audit.rollback.success === false) {
          const rollbackFailure = this.buildRollbackFailure(
            error.message,
            audit.rollback,
            'An unexpected error occurred after writing the candidate change.'
          );

          audit.completedAt = new Date().toISOString();
          audit.summary = rollbackFailure.summary;
          this.recordEvolutionStatus(audit);

          return {
            success: false,
            error: rollbackFailure.error,
            audit
          };
        }
      }

      audit.completedAt = new Date().toISOString();
      audit.summary = wroteCandidate && audit.rollback?.success
        ? `${error.message} Change was rolled back.`
        : error.message;
      this.recordEvolutionStatus(audit);

      return {
        success: false,
        error: wroteCandidate && audit.rollback?.success
          ? `${error.message} Change was rolled back.`
          : error.message,
        audit
      };
    } finally {
      this.clearEvolutionContext();
    }
  },

  async evolveExtension(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(EXTENSION_DIR, params.file);
    if (!targetPath.startsWith(EXTENSION_DIR)) {
      return { success: false, error: 'Cannot modify files outside the extension directory' };
    }

    return await this.applyCodeChange({
      action: 'evolve_extension',
      targetPath,
      code: params.code,
      riskLevel: params.riskLevel || 'low',
      evolutionId: params.evolutionId,
      successResponse: {
        type: 'extension_action',
        action: 'reloadExtension',
        params: { file: params.file },
        success: true,
        result: `Successfully updated ${params.file}. The extension will be reloaded.`
      }
    });
  },

  evolveExtensionSync(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(EXTENSION_DIR, params.file);
    if (!targetPath.startsWith(EXTENSION_DIR)) {
      return { success: false, error: 'Cannot modify files outside the extension directory' };
    }

    if (shouldCheckSyntax(targetPath)) {
      const syntaxCheck = checkSyntax(params.code);
      if (syntaxCheck !== true) {
        return { success: false, error: `Syntax Error: ${syntaxCheck}` };
      }
    }

    try {
      backupAndWrite(targetPath, params.code);
      return {
        type: 'extension_action',
        action: 'reloadExtension',
        params: { file: params.file },
        success: true,
        result: `Successfully updated ${params.file}. The extension will be reloaded.`
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async evolveHandler(params) {
    if (!params || !params.code) {
      return { success: false, error: 'Missing code parameter' };
    }

    return await this.applyCodeChange({
      action: 'evolve_handler',
      targetPath: path.join(SERVER_DIR, 'custom-handler.js'),
      code: params.code,
      riskLevel: params.riskLevel || 'medium',
      evolutionId: params.evolutionId,
      successResponse: {
        success: true,
        result: 'custom-handler.js updated successfully. The server is restarting...'
      }
    });
  },

  evolveHandlerSync(params) {
    if (!params || !params.code) {
      return { success: false, error: 'Missing code parameter' };
    }

    const targetPath = path.join(SERVER_DIR, 'custom-handler.js');
    const syntaxCheck = checkSyntax(params.code);
    if (syntaxCheck !== true) {
      return { success: false, error: `Syntax Error: ${syntaxCheck}` };
    }

    try {
      backupAndWrite(targetPath, params.code);
      return {
        success: true,
        result: 'custom-handler.js updated successfully. The server is restarting...'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async evolveServer(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(SERVER_DIR, params.file);
    if (!targetPath.startsWith(SERVER_DIR)) {
      return { success: false, error: 'Cannot modify files outside the queue-server directory' };
    }

    return await this.applyCodeChange({
      action: 'evolve_server',
      targetPath,
      code: params.code,
      riskLevel: params.riskLevel || 'medium',
      evolutionId: params.evolutionId,
      successResponse: {
        success: true,
        result: `Successfully updated ${params.file}. The server will automatically restart if nodemon is watching this file.`
      }
    });
  },

  evolveServerSync(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(SERVER_DIR, params.file);
    if (!targetPath.startsWith(SERVER_DIR)) {
      return { success: false, error: 'Cannot modify files outside the queue-server directory' };
    }

    if (shouldCheckSyntax(targetPath)) {
      const syntaxCheck = checkSyntax(params.code);
      if (syntaxCheck !== true) {
        return { success: false, error: `Syntax Error: ${syntaxCheck}` };
      }
    }

    try {
      backupAndWrite(targetPath, params.code);
      return {
        success: true,
        result: `Successfully updated ${params.file}. The server will automatically restart if nodemon is watching this file.`
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

module.exports = evolveExecutor;
