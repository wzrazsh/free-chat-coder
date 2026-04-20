const crypto = require('crypto');
const http = require('http');
const https = require('https');
const vm = require('vm');
const {
  DEFAULT_STORE_PATH,
  getRejectedBearerCandidateReason,
  getAuthPageReason,
  isAuthPageUrl,
  isRejectedBearerSource,
  loadAuthState
} = require('./auth');
const {
  parseChatResponse
} = require('./stream');

const DEFAULT_BASE_URL = 'https://chat.deepseek.com';
const DEFAULT_HOSTNAME = 'chat.deepseek.com';
const DEFAULT_ENDPOINT_PATHS = [
  '/api/v0/chat/completion',
  '/api/v0/chat/completions',
  '/api/v1/chat/completion',
  '/api/v1/chat/completions',
  '/api/chat'
];
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_ACCEPT = '*/*';
const DEFAULT_CLIENT_LOCALE = 'zh_CN';
const DEFAULT_APP_VERSION = '20241129.1';
const DEFAULT_CLIENT_VERSION = '1.8.0';
const DEFAULT_CLIENT_PLATFORM = 'web';
const POW_WORKER_MAIN_URL = 'https://fe-static.deepseek.com/chat/static/38401.a8c4129551.js';
const POW_WORKER_DEP_URL = 'https://fe-static.deepseek.com/chat/static/60816.206e80cf1d.js';

let powWorkerScriptsPromise = null;

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
  const persistedBearerSource = String(auth.bearerSource || '');
  const persistedBearerSourceSeparatorIndex = persistedBearerSource.indexOf(':');
  const persistedBearerCandidate = auth.bearerToken
    ? {
        source: persistedBearerSourceSeparatorIndex >= 0
          ? persistedBearerSource.slice(0, persistedBearerSourceSeparatorIndex)
          : 'persisted',
        keyPath: persistedBearerSourceSeparatorIndex >= 0
          ? persistedBearerSource.slice(persistedBearerSourceSeparatorIndex + 1)
          : persistedBearerSource || 'auth.bearerToken',
        value: auth.bearerToken
      }
    : null;
  const rejectedBearerReason = persistedBearerCandidate
    ? getRejectedBearerCandidateReason(persistedBearerCandidate)
    : null;
  const challengeDetected = Boolean(
    authState?.debug?.challengeDetected
      || /aws_?waf|challenge/i.test(String(auth.bearerSource || ''))
  );
  const challengeReason = authState?.debug?.challengeReason || null;
  const authPageDetected = Boolean(
    authState?.debug?.authPageDetected
      || isAuthPageUrl(auth.pageUrl)
  );
  const authPageReason = authState?.debug?.authPageReason || getAuthPageReason(auth.pageUrl);
  const invalidTokenSource = rejectedBearerReason === 'telemetry_source' || isRejectedBearerSource(auth.bearerSource);
  const weakTokenSignal = rejectedBearerReason === 'weak_signal';

  if (challengeDetected) {
    return {
      ready: false,
      storePath: resolvedStorePath,
      reason: 'challenge_page',
      missing: ['bearerToken'],
      capturedAt: authState.capturedAt || authState.savedAt || null,
      pageUrl: auth.pageUrl || null,
      profilePath: authState.profilePath || null,
      challengeReason
    };
  }

  if (authPageDetected) {
    return {
      ready: false,
      storePath: resolvedStorePath,
      reason: 'logged_out',
      missing: ['bearerToken'],
      capturedAt: authState.capturedAt || authState.savedAt || null,
      pageUrl: auth.pageUrl || null,
      profilePath: authState.profilePath || null,
      authPageReason
    };
  }

  if (invalidTokenSource) {
    return {
      ready: false,
      storePath: resolvedStorePath,
      reason: 'telemetry_token',
      missing: ['bearerToken'],
      capturedAt: authState.capturedAt || authState.savedAt || null,
      pageUrl: auth.pageUrl || null,
      profilePath: authState.profilePath || null,
      bearerSource: auth.bearerSource || null
    };
  }

  if (weakTokenSignal) {
    return {
      ready: false,
      storePath: resolvedStorePath,
      reason: 'incomplete_snapshot',
      missing: ['bearerToken'],
      capturedAt: authState.capturedAt || authState.savedAt || null,
      pageUrl: auth.pageUrl || null,
      profilePath: authState.profilePath || null,
      bearerSource: auth.bearerSource || null
    };
  }

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
  if (authSummary.reason === 'challenge_page') {
    throw createProviderError(
      'DEEPSEEK_AUTH_CHALLENGED',
      `DeepSeek Web auth snapshot was captured from the AWS WAF challenge page, not an authenticated chat session. ${onboardingHint}`,
      authSummary,
      503
    );
  }

  if (authSummary.reason === 'logged_out') {
    throw createProviderError(
      'DEEPSEEK_AUTH_LOGGED_OUT',
      `DeepSeek Web auth snapshot was captured from the sign-in page instead of the authenticated chat app. ${onboardingHint}`,
      authSummary,
      503
    );
  }

  if (authSummary.reason === 'telemetry_token') {
    throw createProviderError(
      'DEEPSEEK_AUTH_TOKEN_SOURCE_INVALID',
      `DeepSeek Web auth snapshot captured a telemetry token source (${authSummary.bearerSource || 'unknown source'}) instead of a usable chat token. ${onboardingHint}`,
      authSummary,
      503
    );
  }

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

function isDefaultDeepSeekHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname === DEFAULT_HOSTNAME;
  } catch (error) {
    return false;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'GET'
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode || 0}`));
          return;
        }

        resolve(body);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function loadPowWorkerScripts() {
  if (!powWorkerScriptsPromise) {
    powWorkerScriptsPromise = Promise.all([
      fetchText(POW_WORKER_MAIN_URL),
      fetchText(POW_WORKER_DEP_URL)
    ]).then(([mainScript, dependencyScript]) => ({
      [POW_WORKER_MAIN_URL]: mainScript,
      [POW_WORKER_DEP_URL]: dependencyScript
    }));
  }

  return powWorkerScriptsPromise;
}

function encodeBase64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

async function solvePowChallenge(challenge) {
  const scripts = await loadPowWorkerScripts();

  return new Promise((resolve, reject) => {
    let settled = false;
    let context = null;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    };
    const sandbox = {
      console,
      performance: { now: () => Date.now() },
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      SharedArrayBuffer,
      URL,
      Buffer,
      Error,
      RangeError,
      TypeError,
      Symbol,
      Map,
      Set,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      Promise,
      postMessage: (message) => {
        if (message?.type === 'pow-answer' && message.answer) {
          settle(resolve, message.answer);
          return;
        }

        settle(reject, message?.error || new Error('PoW worker returned an unexpected response.'));
      },
      importScripts: (...urls) => {
        for (const scriptUrl of urls) {
          const script = scripts[scriptUrl];
          if (!script) {
            throw new Error(`Unsupported DeepSeek PoW worker dependency: ${scriptUrl}`);
          }

          vm.runInContext(script, context, {
            filename: scriptUrl,
            timeout: 30000
          });
        }
      }
    };

    sandbox.self = sandbox;
    context = vm.createContext(sandbox);

    (async () => {
      try {
        vm.runInContext(scripts[POW_WORKER_MAIN_URL], context, {
          filename: POW_WORKER_MAIN_URL,
          timeout: 30000
        });

        for (let attempt = 0; attempt < 20 && typeof sandbox.onmessage !== 'function'; attempt += 1) {
          await new Promise((resolveTick) => setTimeout(resolveTick, 0));
        }

        if (typeof sandbox.onmessage !== 'function') {
          throw new Error('DeepSeek PoW worker did not expose onmessage.');
        }

        sandbox.onmessage({
          data: {
            type: 'pow-challenge',
            challenge
          }
        });

        if (!settled) {
          settle(reject, new Error('DeepSeek PoW worker did not return an answer.'));
        }
      } catch (error) {
        settle(reject, error);
      }
    })();
  });
}

function extractBizData(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (data.biz_code != null && Number(data.biz_code) !== 0) {
    return null;
  }

  return data.biz_data || null;
}

function getChatSessionIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload.chat_session_id
    || payload.chatSessionId
    || payload.session_id
    || payload.sessionId
    || payload.conversation_id
    || payload.conversationId
    || null;
}

function hasAnyDefinedField(payload, fieldNames) {
  return fieldNames.some((fieldName) => payload[fieldName] != null);
}

function resolvePayloadFieldName(rawValue, fallback, aliases) {
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim();
    if (normalized && aliases.includes(normalized)) {
      return normalized;
    }
  }

  return fallback;
}

function applyConversationFields(payload, { providerSessionId, providerParentMessageId, deepseekOptions }) {
  const sessionFieldAliases = ['session_id', 'sessionId', 'conversation_id', 'conversationId'];
  const parentFieldAliases = ['parent_message_id', 'parentMessageId', 'parent_id', 'parentId'];
  const sessionField = resolvePayloadFieldName(
    deepseekOptions.sessionField,
    'session_id',
    sessionFieldAliases
  );
  const parentMessageField = resolvePayloadFieldName(
    deepseekOptions.parentMessageField,
    'parent_message_id',
    parentFieldAliases
  );

  if (providerSessionId && !hasAnyDefinedField(payload, sessionFieldAliases)) {
    payload[sessionField] = providerSessionId;
  }

  if (providerParentMessageId && !hasAnyDefinedField(payload, parentFieldAliases)) {
    payload[parentMessageField] = providerParentMessageId;
  }
}

function getClientTimezoneOffsetSeconds() {
  return String(-new Date().getTimezoneOffset() * 60);
}

function buildRequestHeaders(auth, url, body, payloadLength, deepseekOptions) {
  const sessionReferer = body?.chat_session_id
    ? `${url.origin}/a/chat/s/${body.chat_session_id}`
    : `${url.origin}/`;
  const requestHeaders = {
    Accept: deepseekOptions.accept || DEFAULT_ACCEPT,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.bearerToken}`,
    Cookie: auth.cookieHeader,
    'User-Agent': auth.userAgent,
    'x-client-locale': deepseekOptions.clientLocale || DEFAULT_CLIENT_LOCALE,
    'x-client-timezone-offset': String(deepseekOptions.clientTimezoneOffset || getClientTimezoneOffsetSeconds()),
    'x-app-version': deepseekOptions.appVersion || DEFAULT_APP_VERSION,
    'x-client-version': deepseekOptions.clientVersion || DEFAULT_CLIENT_VERSION,
    'x-client-platform': deepseekOptions.clientPlatform || DEFAULT_CLIENT_PLATFORM,
    Origin: deepseekOptions.origin || url.origin,
    Referer: deepseekOptions.referer || sessionReferer,
    'Content-Length': payloadLength
  };
  const overrideHeaders = isPlainObject(deepseekOptions.headers) ? deepseekOptions.headers : {};

  for (const [headerName, headerValue] of Object.entries(overrideHeaders)) {
    if (headerValue == null) {
      delete requestHeaders[headerName];
      continue;
    }

    requestHeaders[headerName] = headerValue;
  }

  return requestHeaders;
}

function safeJsonParse(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
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
        prompt: prompt,
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
    if (!hasAnyDefinedField(payload, ['prompt', 'message', 'input', 'messages'])) {
      payload.message = prompt;
    }

    if (payload.stream == null) {
      payload.stream = true;
    }
  }

  if (!hasAnyDefinedField(payload, ['prompt', 'message', 'input', 'messages'])) {
    payload.message = prompt;
  }

  if ((deepseekOptions.includePromptField !== false || !requestBody) && payload.prompt == null) {
    payload.prompt = prompt;
  }

  if (payload.ref_file_ids == null) {
    payload.ref_file_ids = [];
  }

  if (payload.parent_message_id == null && payload.parentMessageId == null && payload.parent_id == null && payload.parentId == null) {
    payload.parent_message_id = providerParentMessageId || null;
  }

  if (payload.model_type == null && payload.modelType == null) {
    payload.model_type = deepseekOptions.modelType || 'default';
  }

  if (payload.thinking_enabled == null && payload.thinkingEnabled == null) {
    payload.thinking_enabled = deepseekOptions.thinkingEnabled ?? true;
  }

  if (payload.search_enabled == null && payload.searchEnabled == null) {
    payload.search_enabled = deepseekOptions.searchEnabled ?? true;
  }

  if (payload.preempt == null) {
    payload.preempt = deepseekOptions.preempt ?? false;
  }

  if (deepseekOptions.model && payload.model == null) {
    payload.model = deepseekOptions.model;
  }

  applyConversationFields(payload, {
    providerSessionId,
    providerParentMessageId,
    deepseekOptions
  });

  if (payload.chat_session_id == null && deepseekOptions.includeChatSessionId !== false) {
    payload.chat_session_id = deepseekOptions.chatSessionId || providerSessionId || null;
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

function sendRequest({ baseUrl, endpointPath, body, authState, timeoutMs, task, options = {}, additionalHeaders = null }) {
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const url = new URL(endpointPath, baseUrl);
  const payload = JSON.stringify(body);
  const transport = url.protocol === 'https:' ? https : http;
  const auth = authState.auth || {};
  const requestHeaders = buildRequestHeaders(
    auth,
    url,
    body,
    Buffer.byteLength(payload),
    deepseekOptions
  );
  if (isPlainObject(additionalHeaders)) {
    Object.assign(requestHeaders, additionalHeaders);
  }

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

async function createChatSession({ baseUrl, authState, timeoutMs, task, options = {} }) {
  const response = await sendRequest({
    baseUrl,
    endpointPath: '/api/v0/chat_session/create',
    body: {},
    authState,
    timeoutMs,
    task,
    options
  });
  const payload = safeJsonParse(response.body);
  const bizData = extractBizData(payload);
  const chatSessionId = bizData?.chat_session?.id || null;

  if (!chatSessionId) {
    throw createProviderError(
      'DEEPSEEK_SESSION_CREATE_FAILED',
      'DeepSeek Web did not return a chat session id.',
      {
        stage: 'session-create',
        taskId: task?.id || null,
        statusCode: response.statusCode,
        bodyPreview: redactPreview(response.body)
      },
      502
    );
  }

  return chatSessionId;
}

async function createPowHeader({ baseUrl, endpointPath, authState, timeoutMs, task, options = {} }) {
  const response = await sendRequest({
    baseUrl,
    endpointPath: '/api/v0/chat/create_pow_challenge',
    body: { target_path: endpointPath },
    authState,
    timeoutMs,
    task,
    options
  });
  const payload = safeJsonParse(response.body);
  const bizData = extractBizData(payload);
  const challenge = bizData?.challenge || null;

  if (!challenge) {
    throw createProviderError(
      'DEEPSEEK_POW_CHALLENGE_FAILED',
      'DeepSeek Web did not return a PoW challenge.',
      {
        stage: 'pow-challenge',
        taskId: task?.id || null,
        endpointPath,
        statusCode: response.statusCode,
        bodyPreview: redactPreview(response.body)
      },
      502
    );
  }

  const answer = await solvePowChallenge({
    ...challenge,
    expireAt: challenge.expire_at,
    expireAfter: challenge.expire_after
  });

  return encodeBase64Json({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer: answer.answer,
    signature: challenge.signature,
    target_path: endpointPath
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

function buildApiResponseError(response, task, endpointPath, payload) {
  const apiCode = payload?.code != null ? String(payload.code) : null;
  const reason = String(payload?.msg || payload?.message || '').trim() || null;
  const authInvalid = apiCode === '40003' || /INVALID_TOKEN/i.test(reason || '');

  return createProviderError(
    authInvalid ? 'DEEPSEEK_AUTH_INVALID' : 'DEEPSEEK_API_ERROR',
    authInvalid
      ? 'DeepSeek Web rejected the captured auth token.'
      : `DeepSeek Web returned an API error${apiCode ? ` (${apiCode})` : ''}.`,
    {
      stage: 'http-response',
      taskId: task?.id || null,
      endpointPath,
      statusCode: response.statusCode,
      contentType: response?.headers?.['content-type'] || null,
      apiCode,
      reason,
      bodyPreview: redactPreview(response.body)
    },
    authInvalid ? 503 : 502
  );
}

async function dispatchRequest(task, authState, options = {}) {
  const baseUrl = resolveBaseUrl(task, options);
  const endpointPaths = resolveEndpointPaths(task, options);
  const timeoutMs = resolveTimeoutMs(task, options);
  const isHostedDeepSeek = isDefaultDeepSeekHost(baseUrl);
  const deepseekOptions = resolveDeepseekOptions(task, options);
  const request = buildRequestPayload(task, options);
  let lastError = null;

  if (!getChatSessionIdFromPayload(request.payload) && isHostedDeepSeek && deepseekOptions.autoCreateSession !== false) {
    const chatSessionId = await createChatSession({
      baseUrl,
      authState,
      timeoutMs,
      task,
      options
    });
    request.payload.chat_session_id = chatSessionId;
    request.providerSessionId = chatSessionId;
  }

  for (let index = 0; index < endpointPaths.length; index += 1) {
    const endpointPath = endpointPaths[index];
    let response = null;
    let additionalHeaders = null;

    try {
      if (isHostedDeepSeek && deepseekOptions.enablePow !== false) {
        additionalHeaders = {
          'X-DS-PoW-Response': await createPowHeader({
            baseUrl,
            endpointPath,
            authState,
            timeoutMs,
            task,
            options
          })
        };
      }

      response = await sendRequest({
        baseUrl,
        endpointPath,
        body: request.payload,
        authState,
        timeoutMs,
        task,
        options,
        additionalHeaders
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

    const apiPayload = safeJsonParse(response.body);
    if (apiPayload && typeof apiPayload === 'object' && !Array.isArray(apiPayload)) {
      const reason = String(apiPayload.msg || apiPayload.message || '').trim();
      if (apiPayload.code != null || reason) {
        throw buildApiResponseError(response, task, endpointPath, apiPayload);
      }
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
