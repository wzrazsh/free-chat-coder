const path = require('path');

const DEFAULT_QUEUE_PORT = 8080;
const DEFAULT_WEB_IDE_PORT = 8081;
const DEFAULT_QUEUE_PORT_CANDIDATES = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

const getEnv = (key, defaultValue) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return defaultValue;
};

const getEnvNumber = (key, defaultValue) => {
  const value = Number(getEnv(key, defaultValue));
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
};

const buildQueuePortCandidates = (preferredPort) => {
  return Array.from(
    new Set([preferredPort, ...DEFAULT_QUEUE_PORT_CANDIDATES].filter((port) => Number.isInteger(port) && port > 0))
  );
};

const queuePreferredPort = getEnvNumber('QUEUE_PORT', getEnvNumber('PORT', DEFAULT_QUEUE_PORT));
const webIdePort = getEnvNumber('WEB_IDE_PORT', DEFAULT_WEB_IDE_PORT);

const features = {
  // Auto-evolve features permanently disabled (Phase 1 prune).
  enableAutoEvolve: getEnv('FCC_ENABLE_AUTO_EVOLVE', 'false').toLowerCase() === 'true',
  enableEvolveApi: getEnv('FCC_ENABLE_EVOLVE_API', 'false').toLowerCase() === 'true'
};

const config = {
  features,

  queueServer: {
    host: getEnv('QUEUE_HOST', '127.0.0.1'),
    serviceName: 'free-chat-coder-queue-server',
    preferredPort: queuePreferredPort,
    port: queuePreferredPort,
    get portCandidates() {
      return buildQueuePortCandidates(this.preferredPort).filter((port) => port !== webIdePort);
    },
    get httpUrl() {
      return `http://${this.host}:${this.port}`;
    },
    get wsUrl() {
      return `ws://${this.host}:${this.port}`;
    }
  },

  webIde: {
    host: getEnv('WEB_IDE_HOST', '127.0.0.1'),
    port: webIdePort,
    get httpUrl() {
      return `http://${this.host}:${this.port}`;
    }
  },

  workspace: {
    path: getEnv('WORKSPACE_PATH', path.resolve(__dirname, '..'))
  }
};

module.exports = config;
