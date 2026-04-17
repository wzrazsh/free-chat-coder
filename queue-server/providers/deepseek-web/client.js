const http = require('http');
const https = require('https');

const {
  DEFAULT_STORE_PATH,
  loadAuthState
} = require('./auth');
const {
  parseChatResponse
} = require('./stream');

const DEFAULT_BASE_URL = 'https://chat.deepseek.com';
const DEFAULT_ENDPOINT_PATHS = [
  '/api/v0/chat/completion',
  '/api/v0/chat/completions',
  '/api/v1/chat/completion',
  '/api/v1/chat/completions',
  '/api/chat'
];
const DEFAULT_TIMEOUT_MS = 45000;

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

  const onboardingHint = 'Run `node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser`, then log in via the workspace browser profile if auth is still missing.';
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveDeepseekOptions(task, options = {}) {
  return {
    ...(isPlainObject(task?.options?.deepseekWeb) ? task.options.deepseekWeb : {}),
    ...(isPlainObject(options.deepseekWeb) ? options.deepseekWeb : {})
  };
}

function normalizeEndpointPath(endpointPath) {
  if (!endpointPath) {
    return null;
  }

  const normalized = String(endpointPath).trim();
  if (!normalized) {
    return null;
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeEndpointPaths(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [];
  for (const endpointPath of values) {
    const pathValue = normalizeEndpointPath(endpointPath);
    if (pathValue && !normalized.includes(pathValue)) {
      normalized.push(pathValue);
    }
  }

  return normalized;
}

function resolveEndpointPaths(task, options = {}) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const explicitPaths = normalizeEndpointPaths(
    deepseekOptions.endpointPaths
      || deepseekOptions.endpointPath
      || options.endpointPaths
      || options.endpointPath
      || process.env.DEEPSEEK_WEB_ENDPOINT_PATHS
      || process.env.DEEPSEEK_WEB_ENDPOINT_PATH
  );

  return explicitPaths.length > 0 ? explicitPaths : DEFAULT_ENDPOINT_PATHS.slice();
}

function resolveTimeoutMs(task, options = {}) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const rawValue = Number(
    deepseekOptions.timeoutMs
      || options.timeoutMs
      || process.env.DEEPSEEK_WEB_TIMEOUT_MS
      || DEFAULT_TIMEOUT_MS
  );

  return Number.isFinite(rawValue) && rawValue > 0
    ? rawValue
    : DEFAULT_TIMEOUT_MS;
}

function resolveBaseUrl(task, options = {}) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const baseUrl = deepseekOptions.baseUrl
    || options.baseUrl
    || process.env.DEEPSEEK_WEB_BASE_URL
    || DEFAULT_BASE_URL;

  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    throw createProviderError(
      'DEEPSEEK_CONFIG_INVALID',
      `DeepSeek Web base URL is invalid: ${baseUrl}`,
      {
        stage: 'request-config',
        baseUrl,
        reason: error.message
      },
      500
    );
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRequestPayload(task, options = {}) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const prompt = String(options.prompt || task?.prompt || '').trim();

  if (!prompt) {
    throw createProviderError(
      'DEEPSEEK_PROMPT_REQUIRED',
      'DeepSeek Web provider received an empty prompt.',
      {
        stage: 'request-build',
        taskId: task?.id || null
      },
      400
    );
  }

  const requestBody = deepseekOptions.requestBody;
  if (requestBody != null && !isPlainObject(requestBody)) {
    throw createProviderError(
      'DEEPSEEK_CONFIG_INVALID',
      'DeepSeek Web requestBody must be a plain object when provided.',
      {
        stage: 'request-build',
        taskId: task?.id || null
      },
      500
    );
  }

  const payload = requestBody
    ? cloneJson(requestBody)
    : {
        message: prompt,
        stream: true
      };
  const providerSessionId = deepseekOptions.providerSessionId
    || task?.providerSessionId
    || task?.options?.providerSessionId
    || null;
  const providerParentMessageId = deepseekOptions.providerParentMessageId
    || task?.providerParentMessageId
    || task?.options?.providerParentMessageId
    || null;

  if (!requestBody) {
    if (payload.message == null && payload.prompt == null && payload.input == null) {
      payload.message = prompt;
    }

    if (payload.stream == null) {
      payload.stream = true;
    }
  }

  if (payload.message == null && payload.prompt == null && payload.input == null) {
    payload.message = prompt;
  }

  if (deepseekOptions.model && payload.model == null) {
    payload.model = deepseekOptions.model;
  }

  if (providerSessionId && payload.session_id == null && payload.sessionId == null && payload.conversation_id == null && payload.conversationId == null) {
    payload.session_id = providerSessionId;
  }

  if (providerParentMessageId && payload.parent_message_id == null && payload.parentMessageId == null && payload.parent_id == null && payload.parentId == null) {
    payload.parent_message_id = providerParentMessageId;
  }

  return {
    payload,
    providerSessionId,
    providerParentMessageId
  };
}

function redactPreview(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/ig, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}/g, '[REDACTED_TOKEN]')
    .slice(0, 240);
}

function sendRequest({ baseUrl, endpointPath, body, authState, timeoutMs, task, options = {} }) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const url = new URL(endpointPath, baseUrl);
  const payload = JSON.stringify(body);
  const transport = url.protocol === 'https:' ? https : http;
  const auth = authState.auth || {};
  const requestHeaders = {
    ...(isPlainObject(deepseekOptions.headers) ? deepseekOptions.headers : {}),
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.bearerToken}`,
    Cookie: auth.cookieHeader,
    'User-Agent': auth.userAgent,
    Origin: url.origin,
    Referer: `${url.origin}/`,
    'Content-Length': Buffer.byteLength(payload)
  };

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: requestHeaders
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: responseBody
        });
      });
    });

    req.on('error', (error) => {
      if (error?.code && String(error.code).startsWith('DEEPSEEK_')) {
        reject(error);
        return;
      }

      reject(createProviderError(
        'DEEPSEEK_REQUEST_FAILED',
        `DeepSeek Web request failed before a response was received: ${error.message}`,
        {
          stage: 'http-request',
          taskId: task?.id || null,
          endpointPath,
          reason: error.message
        },
        502
      ));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(createProviderError(
        'DEEPSEEK_REQUEST_TIMEOUT',
        `DeepSeek Web request timed out after ${timeoutMs}ms.`,
        {
          stage: 'http-request',
          taskId: task?.id || null,
          endpointPath,
          timeoutMs
        },
        504
      ));
    });

    req.write(payload);
    req.end();
  });
}

function buildResponseError(response, task, endpointPath) {
  return createProviderError(
    'DEEPSEEK_HTTP_ERROR',
    `DeepSeek Web request failed with HTTP ${response.statusCode}.`,
    {
      stage: 'http-response',
      taskId: task?.id || null,
      endpointPath,
      statusCode: response.statusCode,
      contentType: response?.headers?.['content-type'] || null,
      bodyPreview: redactPreview(response.body)
    },
    response.statusCode || 502
  );
}

async function dispatchRequest(task, authState, options = {}) {
  const baseUrl = resolveBaseUrl(task, options);
  const endpointPaths = resolveEndpointPaths(task, options);
  const timeoutMs = resolveTimeoutMs(task, options);
  const request = buildRequestPayload(task, options);
  let lastError = null;

  for (let index = 0; index < endpointPaths.length; index += 1) {
    const endpointPath = endpointPaths[index];
    let response = null;

    try {
      response = await sendRequest({
        baseUrl,
        endpointPath,
        body: request.payload,
        authState,
        timeoutMs,
        task,
        options
      });
    } catch (error) {
      lastError = error;
      break;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      lastError = buildResponseError(response, task, endpointPath);
      const shouldTryNextPath = (response.statusCode === 404 || response.statusCode === 405) && index < endpointPaths.length - 1;
      if (shouldTryNextPath) {
        continue;
      }
      throw lastError;
    }

    const parsed = parseChatResponse(response);
    if (!parsed.text) {
      throw createProviderError(
        'DEEPSEEK_RESPONSE_EMPTY',
        'DeepSeek Web response did not contain assistant text.',
        {
          stage: 'response-parse',
          taskId: task?.id || null,
          endpointPath,
          mode: parsed.mode,
          statusCode: response.statusCode
        },
        502
      );
    }

    return {
      text: parsed.text,
      endpointPath,
      providerSessionId: parsed.sessionId || request.providerSessionId || null,
      providerParentMessageId: parsed.messageId || parsed.parentMessageId || request.providerParentMessageId || null,
      providerMessageId: parsed.messageId || null,
      requestId: parsed.requestId || null,
      responseMode: parsed.mode
    };
  }

  throw lastError || createProviderError(
    'DEEPSEEK_REQUEST_FAILED',
    'DeepSeek Web request could not be dispatched.',
    {
      stage: 'http-request',
      taskId: task?.id || null
    },
    502
  );
}

async function executeTextTask(task, options = {}) {
  const storePath = options.storePath || task?.options?.authStorePath || null;
  assertAuthReady(storePath);
  const authState = getAuthState(storePath);
  return dispatchRequest(task, authState, options);
}

module.exports = {
  executeTextTask,
  inspectAuthState
};
