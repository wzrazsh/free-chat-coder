(function registerQueueConfig(globalScope) {
  const QUEUE_SERVER_HOST = 'localhost';
  const QUEUE_SERVER_SERVICE = 'free-chat-coder-queue-server';
  const QUEUE_PORT_CANDIDATES = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

  let cachedTarget = null;
  let inflightDiscovery = null;

  function buildQueueServerTarget(port) {
    return {
      host: QUEUE_SERVER_HOST,
      port,
      httpUrl: `http://${QUEUE_SERVER_HOST}:${port}`,
      wsUrl: `ws://${QUEUE_SERVER_HOST}:${port}`
    };
  }

  async function fetchWithTimeout(url, timeoutMs = 800) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function probeQueueServer(target, timeoutMs = 800) {
    try {
      const response = await fetchWithTimeout(`${target.httpUrl}/health`, timeoutMs);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data?.status !== 'ok' || data?.service !== QUEUE_SERVER_SERVICE) {
        return null;
      }

      return buildQueueServerTarget(typeof data.port === 'number' ? data.port : target.port);
    } catch (error) {
      return null;
    }
  }

  async function discoverQueueServer(options = {}) {
    const force = options.force === true;
    const timeoutMs = options.timeoutMs || 800;

    if (!force && cachedTarget) {
      const activeTarget = await probeQueueServer(cachedTarget, timeoutMs);
      if (activeTarget) {
        cachedTarget = activeTarget;
        return activeTarget;
      }

      cachedTarget = null;
    }

    if (inflightDiscovery) {
      return inflightDiscovery;
    }

    inflightDiscovery = (async () => {
      for (const port of QUEUE_PORT_CANDIDATES) {
        const activeTarget = await probeQueueServer(buildQueueServerTarget(port), timeoutMs);
        if (activeTarget) {
          cachedTarget = activeTarget;
          return activeTarget;
        }
      }

      throw new Error('Queue server not found on candidate ports.');
    })();

    try {
      return await inflightDiscovery;
    } finally {
      inflightDiscovery = null;
    }
  }

  function clearQueueServerCache() {
    cachedTarget = null;
    inflightDiscovery = null;
  }

  globalScope.queueConfig = {
    preferredPort: QUEUE_PORT_CANDIDATES[0],
    queuePortCandidates: QUEUE_PORT_CANDIDATES,
    buildQueueServerTarget,
    clearQueueServerCache,
    discoverQueueServer,
    probeQueueServer
  };
})(globalThis);
