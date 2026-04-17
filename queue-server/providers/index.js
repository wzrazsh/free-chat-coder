const deepseekWebProvider = require('./deepseek-web/client');

const DEFAULT_PROVIDER = 'extension-dom';

const providers = {
  'extension-dom': {
    id: 'extension-dom',
    kind: 'extension'
  },
  'deepseek-web': {
    id: 'deepseek-web',
    kind: 'server',
    executeTextTask: deepseekWebProvider.executeTextTask,
    inspectAuthState: deepseekWebProvider.inspectAuthState
  }
};

function isKnownProvider(providerId) {
  return Boolean(providerId && providers[providerId]);
}

function getTaskProvider(taskOrOptions) {
  const rawProvider = typeof taskOrOptions === 'string'
    ? taskOrOptions
    : taskOrOptions?.options?.provider || taskOrOptions?.provider;

  return isKnownProvider(rawProvider) ? rawProvider : DEFAULT_PROVIDER;
}

function normalizeTaskOptions(options = {}) {
  return {
    ...options,
    provider: getTaskProvider(options)
  };
}

function isServerSideProvider(providerId) {
  return providers[getTaskProvider(providerId)]?.kind === 'server';
}

function canDispatchTask(task, context = {}) {
  const providerId = getTaskProvider(task);
  if (providerId === 'deepseek-web') {
    return !context.deepseekWebBusy;
  }

  return Boolean(context.extensionAvailable);
}

async function executeTask(task, options = {}) {
  const providerId = getTaskProvider(task);
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  if (provider.kind !== 'server' || typeof provider.executeTextTask !== 'function') {
    throw new Error(`Provider ${providerId} does not support server-side execution.`);
  }

  return provider.executeTextTask(task, options);
}

module.exports = {
  DEFAULT_PROVIDER,
  canDispatchTask,
  executeTask,
  getTaskProvider,
  isKnownProvider,
  isServerSideProvider,
  normalizeTaskOptions,
  providers
};
