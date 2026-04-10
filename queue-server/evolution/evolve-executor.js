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

const evolveExecutor = {
  /**
   * 修改 Chrome 扩展代码并触发重载
   */
  evolveExtension(params) {
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
   */
  evolveHandler(params) {
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
   */
  evolveServer(params) {
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
