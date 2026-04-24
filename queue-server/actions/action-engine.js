const fileExecutor = require('../evolution/file-executor');
const codeExecutor = require('../evolution/code-executor');
const systemExecutor = require('../evolution/system-executor');
const evolveExecutor = require('../evolution/evolve-executor');

// Feature flag: auto-evolve actions are disabled in the refactored architecture.
const disabledEvolveAction = () => ({ success: false, error: 'Evolve actions are disabled by configuration.' });
const confirmManager = require('./confirm-manager');

// 执行器注册表，定义每个动作的处理函数和风险等级
const actionRegistry = {
  // === 文件操作 ===
  read_file: { executor: fileExecutor.readFile, riskLevel: 'low', requireConfirm: false },
  write_file: { executor: fileExecutor.writeFile, riskLevel: 'high', requireConfirm: true },
  list_files: { executor: fileExecutor.listFiles, riskLevel: 'low', requireConfirm: false },

  // === 代码操作 ===
  run_code: { executor: codeExecutor.runCode, riskLevel: 'medium', requireConfirm: false },
  install_package: { executor: codeExecutor.installPackage, riskLevel: 'high', requireConfirm: true },

  // === 系统操作 ===
  execute_command: { executor: systemExecutor.executeCommand, riskLevel: 'high', requireConfirm: true },
  get_system_info: { executor: systemExecutor.getSystemInfo, riskLevel: 'low', requireConfirm: false },

  // === 自我进化操作 (FROZEN) ===
  evolve_handler: { executor: disabledEvolveAction, riskLevel: 'high', requireConfirm: false },
  evolve_extension: { executor: disabledEvolveAction, riskLevel: 'high', requireConfirm: false },
  evolve_server: { executor: disabledEvolveAction, riskLevel: 'high', requireConfirm: false },

  // === DeepSeek 页面交互操作 ===
  // 这些操作不能在 Node.js 中直接执行，需要通过 WebSocket 发送给 Chrome 扩展
  // 我们在 executor 中返回一个特殊结构，告诉 custom-handler 这是扩展指令
  switch_mode: { 
    executor: (params) => ({ type: 'extension_action', action: 'setModelMode', params }), 
    riskLevel: 'low', requireConfirm: false 
  },
  upload_screenshot: { 
    executor: (params) => ({ type: 'extension_action', action: 'captureScreenshot', params: { ...params, uploadToChat: true } }), 
    riskLevel: 'low', requireConfirm: false 
  },
  new_session: { 
    executor: (params) => ({ type: 'extension_action', action: 'createSession', params }), 
    riskLevel: 'low', requireConfirm: false 
  },
  switch_session: { 
    executor: (params) => ({ type: 'extension_action', action: 'switchSession', params }), 
    riskLevel: 'low', requireConfirm: false 
  },
  
  // === 反馈/其他 ===
  send_message: { 
    executor: (params) => ({ type: 'extension_action', action: 'submitPrompt', params: { prompt: params.message, waitForReply: false } }), 
    riskLevel: 'low', requireConfirm: false 
  }
};

class ActionEngine {
  /**
   * 执行单个动作
   * @param {Object} task 关联的任务对象
   * @param {Object} actionInfo 解析出的动作对象 { action: "...", params: {...} }
   * @returns {Promise<Object>} 执行结果，比如 { success: true, result: {...} }
   */
  async execute(task, actionInfo) {
    const { action, params } = actionInfo;
    
    console.log(`[ActionEngine] Executing action: ${action}`, JSON.stringify(params).slice(0, 100));

    if (!actionRegistry[action]) {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const definition = actionRegistry[action];

    // 如果需要确认，先走确认流程
    if (definition.requireConfirm) {
      const approved = await new Promise(resolve => {
        confirmManager.requestConfirm(
          { taskId: task.id, action, params, riskLevel: definition.riskLevel, task },
          resolve
        );
      });

      if (!approved) {
        return { success: false, error: `Action '${action}' was rejected by user.` };
      }
    }

    try {
      // 调用具体的 executor
      const result = await definition.executor(params);
      return result;
    } catch (err) {
      console.error(`[ActionEngine] Error executing ${action}:`, err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new ActionEngine();
