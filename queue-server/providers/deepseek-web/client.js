const {
  DEFAULT_STORE_PATH,
  loadAuthState
} = require('./auth');

function createProviderError(code, message, details = {}, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function getAuthState(storePath) {
  try {
    return loadAuthState({ storePath });
  } catch (error) {
    throw createProviderError(
      'DEEPSEEK_AUTH_INVALID',
      'DeepSeek Web auth snapshot is unreadable. Re-run onboarding before retrying.',
      {
        stage: 'auth-load',
        storePath: storePath || DEFAULT_STORE_PATH,
        reason: error.message
      },
      500
    );
  }
}

function inspectAuthState(storePath) {
  const resolvedStorePath = storePath || DEFAULT_STORE_PATH;
  const authState = getAuthState(resolvedStorePath);

  if (!authState) {
    return {
      ready: false,
      storePath: resolvedStorePath,
      reason: 'missing_snapshot',
      missing: ['cookieHeader', 'bearerToken', 'userAgent'],
      capturedAt: null,
      pageUrl: null
    };
  }

  const auth = authState.auth || {};
  const missing = ['cookieHeader', 'bearerToken', 'userAgent']
    .filter((field) => !auth[field]);

  return {
    ready: missing.length === 0 && authState.ready !== false,
    storePath: resolvedStorePath,
    reason: missing.length === 0 ? null : 'incomplete_snapshot',
    missing,
    capturedAt: authState.capturedAt || authState.savedAt || null,
    pageUrl: auth.pageUrl || null,
    profilePath: authState.profilePath || null
  };
}

function assertAuthReady(storePath) {
  const authSummary = inspectAuthState(storePath);
  if (authSummary.ready) {
    return authSummary;
  }

  const onboardingHint = 'Run `node scripts/onboard-deepseek-web.js --profile .browser-profile` after logging in via the workspace browser profile.';
  if (authSummary.reason === 'missing_snapshot') {
    throw createProviderError(
      'DEEPSEEK_AUTH_REQUIRED',
      `DeepSeek Web auth snapshot is missing. ${onboardingHint}`,
      authSummary,
      503
    );
  }

  throw createProviderError(
    'DEEPSEEK_AUTH_INCOMPLETE',
    `DeepSeek Web auth snapshot is incomplete (${authSummary.missing.join(', ')}). ${onboardingHint}`,
    authSummary,
    503
  );
}

async function executeTextTask(task, options = {}) {
  const authSummary = assertAuthReady(options.storePath || task?.options?.authStorePath || null);

  throw createProviderError(
    'DEEPSEEK_PROVIDER_NOT_IMPLEMENTED',
    'DeepSeek Web provider dispatch is wired, but the HTTP chat transport is not implemented yet.',
    {
      stage: 'provider-bootstrap',
      taskId: task?.id || null,
      provider: 'deepseek-web',
      authReady: authSummary.ready,
      pageUrl: authSummary.pageUrl || null
    },
    501
  );
}

module.exports = {
  executeTextTask,
  inspectAuthState
};
