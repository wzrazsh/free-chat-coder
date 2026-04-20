const vm = require('vm');
const { execSync } = require('child_process');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../');

const codeExecutor = {
  runCode(params) {
    if (!params || !params.code) {
      return { success: false, error: 'Missing code parameter' };
    }
    const timeout = params.timeout || 5000;
    try {
      const sandbox = {
        console: { log: (...args) => sandbox.__logs.push(args.join(' ')) },
        __logs: [],
        require: (mod) => {
          const allowed = ['path', 'fs', 'util', 'crypto', 'url', 'os'];
          if (allowed.includes(mod)) return require(mod);
          throw new Error(`Module '${mod}' is not allowed in sandbox`);
        },
        JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Buffer
      };
      
      const context = vm.createContext(sandbox);
      const result = vm.runInContext(params.code, context, { timeout });
      
      return {
        success: true,
        result: { 
          returnValue: result, 
          logs: sandbox.__logs 
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  installPackage(params) {
    if (!params || !params.package) {
      return { success: false, error: 'Missing package parameter' };
    }
    
    // 安全检查，防止注入命令
    const pkg = params.package.replace(/[^a-zA-Z0-9@/._-]/g, '');
    if (!pkg) {
      return { success: false, error: 'Invalid package name' };
    }

    const cmd = params.dev
      ? `npm install --save-dev ${pkg}`
      : `npm install ${pkg}`;
      
    try {
      const output = execSync(cmd, {
        cwd: WORKSPACE_ROOT,
        timeout: 60000,
        encoding: 'utf8'
      });
      // 截取最后500个字符避免输出过长
      return { success: true, result: { output: output.length > 500 ? '...' + output.slice(-500) : output } };
    } catch (err) {
      return { success: false, error: err.message, output: err.stdout || err.stderr };
    }
  }
};

module.exports = codeExecutor;
