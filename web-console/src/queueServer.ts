const QUEUE_SERVER_HOST = '127.0.0.1';
const QUEUE_SERVER_SERVICE = 'free-chat-coder-queue-server';
const QUEUE_PORT_CANDIDATES = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

export interface QueueServerTarget {
  host: string;
  port: number;
  httpUrl: string;
  wsUrl: string;
}

let cachedTarget: QueueServerTarget | null = null;
let inflightDiscovery: Promise<QueueServerTarget> | null = null;

const buildQueueServerTarget = (port: number): QueueServerTarget => ({
  host: QUEUE_SERVER_HOST,
  port,
  httpUrl: `http://${QUEUE_SERVER_HOST}:${port}`,
  wsUrl: `ws://${QUEUE_SERVER_HOST}:${port}`,
});

const fetchWithTimeout = async (url: string, timeoutMs = 800) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const probeQueueServer = async (
  target: QueueServerTarget,
  timeoutMs = 800,
): Promise<QueueServerTarget | null> => {
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
  } catch {
    return null;
  }
};

export const discoverQueueServer = async ({
  force = false,
  timeoutMs = 800,
}: {
  force?: boolean;
  timeoutMs?: number;
} = {}): Promise<QueueServerTarget> => {
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
};

export const clearDiscoveredQueueServer = () => {
  cachedTarget = null;
  inflightDiscovery = null;
};

export const requestQueueServer = async (
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; target: QueueServerTarget }> => {
  let target = await discoverQueueServer();

  try {
    return {
      response: await fetch(`${target.httpUrl}${path}`, init),
      target,
    };
  } catch (error) {
    clearDiscoveredQueueServer();
    target = await discoverQueueServer({ force: true });
    return {
      response: await fetch(`${target.httpUrl}${path}`, init),
      target,
    };
  }
};
