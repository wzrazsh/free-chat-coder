const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../');
const EXTENSION_DIR = path.join(WORKSPACE_ROOT, 'chromevideo');
const SERVER_DIR = path.join(WORKSPACE_ROOT, 'queue-server');

/**
 * 校验 JavaScript 语法
 * @param {string} code
 * @returns {boolean|string} true 或 错误信息
 */
function checkSyntax(code) {
  try {
    new vm.Script(code);
    return true;
  } catch (err) {
    return err.message;
  }
}

/**
 * 备份并覆盖文件
 * @param {string} targetPath 绝对路径
 * @param {string} code
 */
function backupAndWrite(targetPath, code) {
  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, targetPath + '.bak');
  } else {
    // 确保目录存在
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  fs.writeFileSync(targetPath, code, 'utf8');
}

/**
 * 动态导入测试验证服务（避免循环依赖）
 * @returns {Object|null}
 */
function getValidationService() {
  try {
    const validatorPath = path.join(SERVER_DIR, 'test-validator', 'validation-service.js');
    if (fs.existsSync(validatorPath)) {
      return require(validatorPath);
    }
    return null;
  } catch (error) {
    console.warn('[EvolveExecutor] Validation service not available:', error.message);
    return null;
  }
}

/**
 * 动态导入回滚管理器
 * @returns {Object|null}
 */
function getRollbackManager() {
  try {
    const rollbackPath = path.join(SERVER_DIR, 'test-validator', 'rollback-manager.js');
    if (fs.existsSync(rollbackPath)) {
      return require(rollbackPath);
    }
    return null;
  } catch (error) {
    console.warn('[EvolveExecutor] Rollback manager not available:', error.message);
    return null;
  }
}

const evolveExecutor = {
  /**
   * 进化上下文（用于跟踪多次进化的关联）
   */
  _evolutionContext: null,

  /**
   * 设置进化上下文
   * @param {Object} context
   */
  setEvolutionContext(context) {
    this._evolutionContext = {
      evolutionId: context.evolutionId || `evolve-${Date.now()}`,
      action: context.action,
      riskLevel: context.riskLevel || 'low',
      startTime: Date.now(),
      backups: []
    };
  },

  /**
   * 获取当前进化上下文
   * @returns {Object|null}
   */
  getEvolutionContext() {
    return this._evolutionContext;
  },

  /**
   * 清除进化上下文
   */
  clearEvolutionContext() {
    this._evolutionContext = null;
  },

  /**
   * 执行验证钩子
   * @param {string} action - 进化动作
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async runValidationHook(action, options = {}) {
    const validationService = getValidationService();
    if (!validationService) {
      console.log('[EvolveExecutor] Validation service not available, skipping validation');
      return { success: true, skipped: true, reason: 'Validation service not available' };
    }

    const context = this._evolutionContext || {};
    const evolutionId = context.evolutionId || `evolve-${Date.now()}`;

    console.log(`[EvolveExecutor] Running validation hook for: ${evolutionId}`);

    try {
      const validationResult = await validationService.validationService.runP0Validation({
        evolutionId,
        action,
        riskLevel: context.riskLevel || 'low',
        testSpecific: true
      });

      console.log(`[EvolveExecutor] Validation result: ${JSON.stringify({
        success: validationResult.success,
        decision: validationResult.decision?.action
      })}`);

      return validationResult;
    } catch (error) {
      console.error('[EvolveExecutor] Validation hook error:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * 执行自动回滚
   * @param {string} evolutionId
   * @returns {Promise<Object>}
   */
  async performRollback(evolutionId) {
    const rollbackManager = getRollbackManager();
    if (!rollbackManager) {
      console.warn('[EvolveExecutor] Rollback manager not available');
      return { success: false, error: 'Rollback manager not available' };
    }

    console.log(`[EvolveExecutor] Performing rollback for: ${evolutionId}`);

    try {
      const result = await rollbackManager.rollbackManager.rollback(evolutionId);
      console.log(`[EvolveExecutor] Rollback result: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      console.error('[EvolveExecutor] Rollback error:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * 验证并回滚（如果在P0测试失败）
   * @param {Object} validationResult
   * @returns {Promise<Object>}
   */
  async validateAndRollback(validationResult) {
    if (validationResult.success) {
      return validationResult;
    }

    const validationService = getValidationService();
    if (!validationService) {
      return validationResult;
    }

    return await validationService.validationService.validateAndRollback(validationResult);
  },

  /**
   * 修改 Chrome 扩展代码并触发重载
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async evolveExtension(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    // 安全检查，仅允许修改 chromevideo 目录下的文件
    const targetPath = path.resolve(EXTENSION_DIR, params.file);
    if (!targetPath.startsWith(EXTENSION_DIR)) {
      return { success: false, error: 'Cannot modify files outside the extension directory' };
    }

    // 对于 js 文件，进行基础语法检查
    if (targetPath.endsWith('.js')) {
      const syntaxCheck = checkSyntax(params.code);
      if (syntaxCheck !== true) {
        return { success: false, error: `Syntax Error: ${syntaxCheck}` };
      }
    }

    // 设置进化上下文
    this.setEvolutionContext({
      evolutionId: params.evolutionId || `evolve-${Date.now()}`,
      action: 'evolve_extension',
      riskLevel: params.riskLevel || 'low',
      targetPath
    });

    // 创建备份（用于回滚）
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, targetPath + '.bak');
      if (this._evolutionContext) {
        this._evolutionContext.backups.push({
          path: targetPath,
          backup: targetPath + '.bak'
        });
      }
    } else {
      // 确保目录存在
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }

    try {
      // 写入新代码
      fs.writeFileSync(targetPath, params.code, 'utf8');

      // 执行验证钩子（代码修改后触发验证）
      const validationResult = await this.runValidationHook('evolve_extension', {
        targetPath,
        evolutionId: this._evolutionContext?.evolutionId
      });

      // 如果验证失败，尝试回滚
      let finalResult = { ...validationResult };

      if (!validationResult.success) {
        console.log('[EvolveExecutor] Validation failed, attempting rollback...');

        // 恢复备份
        if (fs.existsSync(targetPath + '.bak')) {
          fs.copyFileSync(targetPath + '.bak', targetPath);
          fs.unlinkSync(targetPath + '.bak');
        }

        finalResult.rollbackPerformed = true;
        finalResult.rollbackSuccess = true;
        finalResult.message = 'Code rolled back due to test validation failure';
      } else if (this._evolutionContext?.backups?.length > 0) {
        // 验证成功，清理备份
        for (const backup of this._evolutionContext.backups) {
          if (fs.existsSync(backup.backup)) {
            fs.unlinkSync(backup.backup);
          }
        }
      }

      // 清除上下文
      this.clearEvolutionContext();

      // 返回结果
      if (finalResult.success) {
        return {
          type: 'extension_action',
          action: 'reloadExtension',
          params: { file: params.file },
          success: true,
          result: `Successfully updated ${params.file}. The extension will be reloaded.`,
          validation: finalResult
        };
      } else {
        return {
          success: false,
          error: 'Code modification failed validation and was rolled back',
          validation: finalResult
        };
      }

    } catch (err) {
      this.clearEvolutionContext();
      return { success: false, error: err.message };
    }
  },

  /**
   * evolveExtension 的同步版本（向后兼容）
   */
  evolveExtensionSync(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    // 安全检查，仅允许修改 chromevideo 目录下的文件
    const targetPath = path.resolve(EXTENSION_DIR, params.file);
    if (!targetPath.startsWith(EXTENSION_DIR)) {
      return { success: false, error: 'Cannot modify files outside the extension directory' };
    }

    // 对于 js 文件，进行基础语法检查
    if (targetPath.endsWith('.js')) {
      const syntaxCheck = checkSyntax(params.code);
      if (syntaxCheck !== true) {
        return { success: false, error: `Syntax Error: ${syntaxCheck}` };
      }
    }

    try {
      backupAndWrite(targetPath, params.code);

      // 返回特殊格式，让 action-engine 派发 reload_extension 事件给扩展
      return {
        type: 'extension_action',
        action: 'reloadExtension',
        params: { file: params.file },
        success: true,
        result: `Successfully updated ${params.file}. The extension will be reloaded.`
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * 修改 custom-handler.js 逻辑
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async evolveHandler(params) {
    if (!params || !params.code) {
      return { success: false, error: 'Missing code parameter' };
    }

    const targetPath = path.join(SERVER_DIR, 'custom-handler.js');

    // 语法检查
    const syntaxCheck = checkSyntax(params.code);
    if (syntaxCheck !== true) {
      return { success: false, error: `Syntax Error: ${syntaxCheck}` };
    }

    // 设置进化上下文
    this.setEvolutionContext({
      evolutionId: params.evolutionId || `evolve-${Date.now()}`,
      action: 'evolve_handler',
      riskLevel: params.riskLevel || 'medium',
      targetPath
    });

    // 创建备份
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, targetPath + '.bak');
    }

    try {
      // 写入新代码
      fs.writeFileSync(targetPath, params.code, 'utf8');

      // 执行验证钩子
      const validationResult = await this.runValidationHook('evolve_handler', {
        targetPath,
        evolutionId: this._evolutionContext?.evolutionId
      });

      let finalResult = { ...validationResult };

      // 如果验证失败，回滚
      if (!validationResult.success) {
        console.log('[EvolveExecutor] Validation failed for handler, rolling back...');

        if (fs.existsSync(targetPath + '.bak')) {
          fs.copyFileSync(targetPath + '.bak', targetPath);
          fs.unlinkSync(targetPath + '.bak');
        }

        finalResult.rollbackPerformed = true;
        finalResult.rollbackSuccess = true;
      } else if (fs.existsSync(targetPath + '.bak')) {
        // 清理备份
        fs.unlinkSync(targetPath + '.bak');
      }

      this.clearEvolutionContext();

      if (finalResult.success) {
        return {
          success: true,
          result: 'custom-handler.js updated successfully. The server is restarting...',
          validation: finalResult
        };
      } else {
        return {
          success: false,
          error: 'Handler modification failed validation and was rolled back',
          validation: finalResult
        };
      }

    } catch (err) {
      this.clearEvolutionContext();
      return { success: false, error: err.message };
    }
  },

  /**
   * evolveHandler 的同步版本（向后兼容）
   */
  evolveHandlerSync(params) {
    if (!params || !params.code) {
      return { success: false, error: 'Missing code parameter' };
    }

    const targetPath = path.join(SERVER_DIR, 'custom-handler.js');

    // 语法检查
    const syntaxCheck = checkSyntax(params.code);
    if (syntaxCheck !== true) {
      return { success: false, error: `Syntax Error: ${syntaxCheck}` };
    }

    try {
      backupAndWrite(targetPath, params.code);

      // Node.js 中对于 require 的缓存需要重启进程才能生效
      // 由于我们在外部使用了 nodemon 监控 queue-server 目录
      // 修改文件后，nodemon 会自动重启进程
      return {
        success: true,
        result: 'custom-handler.js updated successfully. The server is restarting...'
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * 修改 Queue-Server 的其他代码
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async evolveServer(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(SERVER_DIR, params.file);
    if (!targetPath.startsWith(SERVER_DIR)) {
      return { success: false, error: 'Cannot modify files outside the queue-server directory' };
    }

    if (targetPath.endsWith('.js')) {
      const syntaxCheck = checkSyntax(params.code);
      if (syntaxCheck !== true) {
        return { success: false, error: `Syntax Error: ${syntaxCheck}` };
      }
    }

    // 设置进化上下文
    this.setEvolutionContext({
      evolutionId: params.evolutionId || `evolve-${Date.now()}`,
      action: 'evolve_server',
      riskLevel: params.riskLevel || 'medium',
      targetPath
    });

    // 创建备份
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, targetPath + '.bak');
    }

    try {
      fs.writeFileSync(targetPath, params.code, 'utf8');

      // 执行验证钩子
      const validationResult = await this.runValidationHook('evolve_server', {
        targetPath,
        evolutionId: this._evolutionContext?.evolutionId
      });

      let finalResult = { ...validationResult };

      // 如果验证失败，回滚
      if (!validationResult.success) {
        console.log('[EvolveExecutor] Validation failed for server code, rolling back...');

        if (fs.existsSync(targetPath + '.bak')) {
          fs.copyFileSync(targetPath + '.bak', targetPath);
          fs.unlinkSync(targetPath + '.bak');
        }

        finalResult.rollbackPerformed = true;
        finalResult.rollbackSuccess = true;
      } else if (fs.existsSync(targetPath + '.bak')) {
        fs.unlinkSync(targetPath + '.bak');
      }

      this.clearEvolutionContext();

      if (finalResult.success) {
        return {
          success: true,
          result: `Successfully updated ${params.file}. The server will automatically restart if nodemon is watching this file.`,
          validation: finalResult
        };
      } else {
        return {
          success: false,
          error: 'Server code modification failed validation and was rolled back',
          validation: finalResult
        };
      }

    } catch (err) {
      this.clearEvolutionContext();
      return { success: false, error: err.message };
    }
  },

  /**
   * evolveServer 的同步版本（向后兼容）
   */
  evolveServerSync(params) {
    if (!params || !params.file || !params.code) {
      return { success: false, error: 'Missing file or code parameter' };
    }

    const targetPath = path.resolve(SERVER_DIR, params.file);
    if (!targetPath.startsWith(SERVER_DIR)) {
      return { success: false, error: 'Cannot modify files outside the queue-server directory' };
    }

    if (targetPath.endsWith('.js')) {
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
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = evolveExecutor;
