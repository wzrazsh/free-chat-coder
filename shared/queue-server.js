const http = require('http');
const config = require('./config');

function buildQueueServerTarget(port, host = config.queueServer.host) {
  return {
    host,
    port,
    httpUrl: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}`
  };
}

function probeQueueServer(port, options = {}) {
  const host = options.host || config.queueServer.host;
  const timeoutMs = options.timeoutMs || 800;

  return new Promise((resolve) => {
    const req = http.request({
      host,
      port,
      path: '/health',
      method: 'GET',
      timeout: timeoutMs
    }, (res) => {
      let payload = '';
      res.on('data', (chunk) => {
        payload += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }

        try {
          const data = JSON.parse(payload);
          if (data.status === 'ok' && data.service === config.queueServer.serviceName) {
            resolve({
              ...buildQueueServerTarget(typeof data.port === 'number' ? data.port : port, host),
              health: data
            });
            return;
          }
        } catch (error) {
          // Ignore invalid payload and treat it as not matching the queue service.
        }

        resolve(null);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });

    req.end();
  });
}

async function discoverQueueServer(options = {}) {
  const ports = options.ports || config.queueServer.portCandidates;
  const host = options.host || config.queueServer.host;
  const timeoutMs = options.timeoutMs || 800;

  for (const port of ports) {
    const target = await probeQueueServer(port, { host, timeoutMs });
    if (target) {
      return target;
    }
  }

  return null;
}

module.exports = {
  buildQueueServerTarget,
  discoverQueueServer,
  probeQueueServer
};
