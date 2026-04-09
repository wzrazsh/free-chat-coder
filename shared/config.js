// e:/workspace/free-chat-coder/shared/config.js
// 统一管理各个模块的连接地址和端口配置
// 默认值可以通过各环境的覆盖方式修改

const getEnv = (key, defaultValue) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
};

const config = {
  // Queue Server 配置
  queueServer: {
    host: getEnv('QUEUE_HOST', '127.0.0.1'),
    port: getEnv('QUEUE_PORT', 8082),
    get httpUrl() { return `http://${this.host}:${this.port}`; },
    get wsUrl() { return `ws://${this.host}:${this.port}`; }
  },

  // Web IDE (code-server) 配置
  webIde: {
    host: getEnv('WEB_IDE_HOST', '127.0.0.1'),
    port: getEnv('WEB_IDE_PORT', 8081),
    get httpUrl() { return `http://${this.host}:${this.port}`; }
  },

  // 工作区路径
  workspace: {
    path: getEnv('WORKSPACE_PATH', 'E:/workspace/free-chat-coder')
  }
};

module.exports = config;
