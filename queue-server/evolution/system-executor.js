const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../');

const systemExecutor = {
  executeCommand(params) {
    if (!params || !params.command) {
      return { success: false, error: 'Missing command parameter' };
    }
    
    // 简单的危险命令拦截
    const dangerousPrefixes = ['rm -rf /', 'mkfs', 'dd if=', 'sudo '];
    for (const prefix of dangerousPrefixes) {
      if (params.command.trim().startsWith(prefix)) {
        return { success: false, error: `Command blocked for security reasons: ${prefix}` };
      }
    }

    const cwd = params.cwd ? path.resolve(WORKSPACE_ROOT, params.cwd) : WORKSPACE_ROOT;
    
    // 安全检查：确保执行目录在工作区内
    if (!cwd.startsWith(WORKSPACE_ROOT)) {
      return { success: false, error: 'Working directory outside workspace is not allowed' };
    }

    try {
      const output = execSync(params.command, {
        cwd,
        timeout: 30000,
        encoding: 'utf8'
      });
      // 截取最后2000个字符避免输出过长
      return { 
        success: true, 
        result: { 
          output: output.length > 2000 ? '...\n' + output.slice(-2000) : output,
          cwd
        } 
      };
    } catch (err) {
      return { 
        success: false, 
        error: err.message, 
        stdout: err.stdout ? err.stdout.toString() : '',
        stderr: err.stderr ? err.stderr.toString() : ''
      };
    }
  },

  getSystemInfo() {
    try {
      return {
        success: true,
        result: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpus: os.cpus().length,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          uptime: os.uptime(),
          nodeVersion: process.version,
          cwd: process.cwd()
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = systemExecutor;
