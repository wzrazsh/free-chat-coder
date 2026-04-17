const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const WebSocket = require('ws');

const {
  getDefaultProfileCandidatesForWorkspace
} = require('../../../chromevideo/host/install_host');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_ORIGIN = 'https://chat.deepseek.com/';
const DEFAULT_PROFILE_PATH = path.join(REPO_ROOT, '.browser-profile');
const DEFAULT_STORE_PATH = path.join(REPO_ROOT, 'queue-server', 'data', 'deepseek-web-auth.json');
const AUTH_PAGE_PATH_RE = /^\/(?:sign[_-]?in|signin|login|sign[_-]?up|signup|register|forgot(?:[_-]?password)?|password(?:[_-]?reset)?|reset(?:[_-]?password)?)(?:\/|$)/i;
const TELEMETRY_TOKEN_RE = /(?:^|[._-])(?:__tea_cache|tea_cache|slardar|analytics|tracking|metrics|telemetry|segment|sentry)(?:$|[._-])/i;

function resolveInputPath(targetPath) {
  if (!targetPath) {
    return null;
  }

  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }

  return path.resolve(REPO_ROOT, targetPath);
}

function resolveProfilePath(profilePath) {
  if (profilePath) {
    return resolveInputPath(profilePath);
  }

  const candidates = getDefaultProfileCandidatesForWorkspace(REPO_ROOT, os.homedir());
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ? path.resolve(existing) : DEFAULT_PROFILE_PATH;
}

function resolveStorePath(storePath) {
  return resolveInputPath(storePath) || DEFAULT_STORE_PATH;
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function readDevToolsActivePort(profilePath) {
  const filePath = path.join(profilePath, 'DevToolsActivePort');
  const result = {
    filePath,
    exists: fs.existsSync(filePath),
    port: null,
    browserPath: null,
    browserWebSocketUrl: null
  };

  if (!result.exists) {
    return result;
  }

  try {
    const lines = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines[0] && /^\d+$/.test(lines[0])) {
      result.port = Number(lines[0]);
    }

    if (lines[1]) {
      result.browserPath = lines[1];
    }

    if (result.port && result.browserPath) {
      result.browserWebSocketUrl = `ws://127.0.0.1:${result.port}${result.browserPath}`;
    }
  } catch (error) {
    result.error = error.message || String(error);
  }

  return result;
}

function createHashFingerprint(value) {
  return crypto.createHash('sha256')
    .update(String(value))
    .digest('hex')
    .slice(0, 12);
}

function summarizeSecret(value) {
  if (!value) {
    return {
      present: false
    };
  }

  const stringValue = String(value);
  return {
    present: true,
    length: stringValue.length,
    fingerprint: createHashFingerprint(stringValue)
  };
}

function normalizeOrigin(origin = DEFAULT_ORIGIN) {
  const parsed = new URL(origin);
  return {
    origin: parsed.origin,
    host: parsed.hostname
  };
}

function getAuthPageReason(pageUrl) {
  if (!pageUrl) {
    return null;
  }

  try {
    const parsed = new URL(pageUrl, DEFAULT_ORIGIN);
    if (AUTH_PAGE_PATH_RE.test(parsed.pathname || '/')) {
      return `auth_path:${parsed.pathname || '/'}`;
    }
  } catch (error) {
    // Ignore malformed URLs and fall back to null.
  }

  return null;
}

function isAuthPageUrl(pageUrl) {
  return Boolean(getAuthPageReason(pageUrl));
}

function isRejectedBearerSource(value) {
  return TELEMETRY_TOKEN_RE.test(String(value || ''));
}

function requestJson(url, timeoutMs = 2500) {
  const client = url.startsWith('https:') ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        try {
          resolve(JSON.parse(body || '{}'));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout requesting ${url}`));
    });
  });
}

function connectWebSocket(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeoutId = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timeout connecting to ${url}`));
    }, timeoutMs);

    socket.once('open', () => {
      clearTimeout(timeoutId);
      resolve(socket);
    });

    socket.once('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function closeWebSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, 1000);

    socket.once('close', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    try {
      socket.close();
    } catch (error) {
      clearTimeout(timeoutId);
      resolve();
    }
  });
}

function createCdpClient(socket) {
  let nextId = 0;
  const pending = new Map();

  socket.on('message', (raw) => {
    let message = null;
    try {
      message = JSON.parse(String(raw));
    } catch (error) {
      return;
    }

    if (!message || typeof message.id !== 'number' || !pending.has(message.id)) {
      return;
    }

    const handlers = pending.get(message.id);
    pending.delete(message.id);

    if (message.error) {
      handlers.reject(new Error(message.error.message || 'CDP error'));
      return;
    }

    handlers.resolve(message.result || {});
  });

  socket.on('close', () => {
    pending.forEach((handlers) => {
      handlers.reject(new Error('CDP socket closed'));
    });
    pending.clear();
  });

  socket.on('error', (error) => {
    pending.forEach((handlers) => {
      handlers.reject(error);
    });
    pending.clear();
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });

      try {
        socket.send(JSON.stringify({
          id,
          method,
          params
        }));
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  return {
    send
  };
}

function isCookieRelevant(cookie, host) {
  if (!cookie || !cookie.name || typeof cookie.value === 'undefined') {
    return false;
  }

  const cookieDomain = String(cookie.domain || '')
    .replace(/^\./, '')
    .toLowerCase();
  const targetHost = String(host || '').toLowerCase();

  if (!cookieDomain || !targetHost) {
    return false;
  }

  return targetHost === cookieDomain || targetHost.endsWith(`.${cookieDomain}`);
}

function isCookieExpired(cookie) {
  if (!cookie || typeof cookie.expires !== 'number') {
    return false;
  }

  return cookie.expires > 0 && (cookie.expires * 1000) <= Date.now();
}

function buildCookieHeader(cookies) {
  return cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function fetchBrowserCookies(browserWebSocketUrl) {
  const socket = await connectWebSocket(browserWebSocketUrl);

  try {
    const client = createCdpClient(socket);

    try {
      const result = await client.send('Storage.getCookies');
      if (Array.isArray(result.cookies)) {
        return result.cookies;
      }
    } catch (error) {
      const fallback = await client.send('Network.getAllCookies');
      if (Array.isArray(fallback.cookies)) {
        return fallback.cookies;
      }
    }

    return [];
  } finally {
    await closeWebSocket(socket);
  }
}

function buildStorageInspectionExpression() {
  const lines = [
    '(() => {',
    '  const TOKEN_RE = /bearer|authorization|auth|token|jwt|session/i;',
    '  const CHALLENGE_TEXT_RE = /not a robot|max challenge attempts exceeded|aws_?waf|awswafintegration|challenge-container/i;',
    '  const AUTH_PATH_RE = /^\\/(?:sign[_-]?in|signin|login|sign[_-]?up|signup|register|forgot(?:[_-]?password)?|password(?:[_-]?reset)?|reset(?:[_-]?password)?)(?:\\/|$)/i;',
    '  const AUTH_TEXT_RE = /\\b(sign up|log in|login|forgot password|create account)\\b/i;',
    '  const records = [];',
    '  const seen = new Set();',
    '  const MAX_VALUE_LENGTH = 4096;',
    '  function record(source, keyPath, rawValue) {',
    '    if (rawValue === null || typeof rawValue === "undefined") {',
    '      return;',
    '    }',
    '    const stringValue = String(rawValue);',
    '    const signature = `${source}:${keyPath}:${stringValue}`;',
    '    if (seen.has(signature)) {',
    '      return;',
    '    }',
    '    if (!TOKEN_RE.test(keyPath) && !TOKEN_RE.test(stringValue.slice(0, 180))) {',
    '      return;',
    '    }',
    '    seen.add(signature);',
    '    records.push({',
    '      source,',
    '      keyPath,',
    '      value: stringValue.slice(0, MAX_VALUE_LENGTH),',
    '      valueLength: stringValue.length',
    '    });',
    '  }',
    '  function walk(source, keyPath, value, depth) {',
    '    if (depth > 4 || value === null || typeof value === "undefined") {',
    '      return;',
    '    }',
    '    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {',
    '      record(source, keyPath, value);',
    '      return;',
    '    }',
    '    if (Array.isArray(value)) {',
    '      value.slice(0, 10).forEach((entry, index) => walk(source, `${keyPath}[${index}]`, entry, depth + 1));',
    '      return;',
    '    }',
    '    if (typeof value === "object") {',
    '      Object.entries(value).slice(0, 30).forEach(([childKey, childValue]) => {',
    '        walk(source, `${keyPath}.${childKey}`, childValue, depth + 1);',
    '      });',
    '    }',
    '  }',
    '  function inspectStorage(areaName, storage) {',
    '    const keys = [];',
    '    for (let index = 0; index < storage.length; index += 1) {',
    '      const key = storage.key(index);',
    '      if (!key) {',
    '        continue;',
    '      }',
    '      keys.push(key);',
    '      const rawValue = storage.getItem(key);',
    '      record(areaName, `${areaName}.${key}`, rawValue);',
    '      if (!rawValue) {',
    '        continue;',
    '      }',
    '      try {',
    '        const parsed = JSON.parse(rawValue);',
    '        walk(areaName, `${areaName}.${key}`, parsed, 0);',
    '      } catch (error) {',
    '        // Ignore non-JSON storage entries.',
    '      }',
    '    }',
    '    return keys;',
    '  }',
    '  const localStorageKeys = inspectStorage("localStorage", window.localStorage);',
    '  const sessionStorageKeys = inspectStorage("sessionStorage", window.sessionStorage);',
    '  const hasChatInput = Boolean(document.querySelector("#chat-input") || document.querySelector(\'textarea[placeholder*="message" i]\') || document.querySelector("textarea"));',
    '  const bodyText = (document.body?.innerText || "").slice(0, 2000);',
    '  const bodyHtml = (document.body?.innerHTML || "").slice(0, 2000);',
    '  const pathname = location.pathname || "/";',
    '  const authPageDetected = AUTH_PATH_RE.test(pathname) || (!hasChatInput && AUTH_TEXT_RE.test(bodyText));',
    '  const authPageReason = AUTH_PATH_RE.test(pathname)',
    '    ? `auth_path:${pathname}`',
    '    : (!hasChatInput && AUTH_TEXT_RE.test(bodyText) ? "auth_text_without_chat_input" : null);',
    '  walk("window", "window.__NEXT_DATA__", window.__NEXT_DATA__ || null, 0);',
    '  walk("window", "window.__NUXT__", window.__NUXT__ || null, 0);',
    '  return {',
    '    href: location.href,',
    '    pathname,',
    '    title: document.title,',
    '    origin: location.origin,',
    '    userAgent: navigator.userAgent,',
    '    localStorageKeys,',
    '    sessionStorageKeys,',
    '    hasChatInput,',
    '    authPageDetected,',
    '    authPageReason,',
    '    challengeDetected: Boolean(document.querySelector("#challenge-container") || CHALLENGE_TEXT_RE.test(bodyText) || CHALLENGE_TEXT_RE.test(bodyHtml)),',
    '    challengeReason: /max challenge attempts exceeded/i.test(bodyText)',
    '      ? "max_challenge_attempts_exceeded"',
    '      : document.querySelector("#challenge-container") || /awswafintegration/i.test(bodyHtml)',
    '        ? "aws_waf_challenge"',
    '        : /not a robot/i.test(bodyText)',
    '          ? "robot_check"',
    '          : null,',
    '    tokenCandidates: records.slice(0, 40)',
    '  };',
    '})()'
  ];

  return lines.join('\n');
}

async function inspectDeepSeekTarget(target) {
  if (!target?.webSocketDebuggerUrl) {
    return null;
  }

  const socket = await connectWebSocket(target.webSocketDebuggerUrl);

  try {
    const client = createCdpClient(socket);
    await client.send('Runtime.enable');
    const result = await client.send('Runtime.evaluate', {
      expression: buildStorageInspectionExpression(),
      returnByValue: true
    });

    return result?.result?.value || null;
  } finally {
    await closeWebSocket(socket);
  }
}

function scoreBearerCandidate(candidate) {
  let score = 0;
  const keyPath = String(candidate.keyPath || '');
  const value = String(candidate.value || '');

  if (/bearer|authorization/i.test(keyPath)) {
    score += 100;
  }
  if (/access.?token|id.?token/i.test(keyPath)) {
    score += 80;
  }
  if (/token|auth|jwt/i.test(keyPath)) {
    score += 50;
  }
  if (/^Bearer\s+/i.test(value)) {
    score += 70;
  }
  if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value)) {
    score += 55;
  }
  if (value.length >= 20) {
    score += 10;
  }
  if (candidate.source === 'localStorage') {
    score += 10;
  }
  if (candidate.source === 'sessionStorage') {
    score += 6;
  }

  return score;
}

const TOKEN_WRAPPER_KEY_RE = /^(?:value|token|accessToken|access_token|bearer|bearerToken|bearer_token|authorization|authToken|auth_token|idToken|id_token|jwt)$/i;

function tryParseJson(value) {
  try {
    return {
      ok: true,
      value: JSON.parse(value)
    };
  } catch (error) {
    return {
      ok: false,
      value: null
    };
  }
}

function normalizeBearerToken(value, depth = 0) {
  if (depth > 4 || value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const stringValue = value.trim();
    if (!stringValue) {
      return null;
    }

    const normalizedValue = stringValue.replace(/^Bearer\s+/i, '').trim();
    if (!normalizedValue) {
      return null;
    }

    if (/^(?:null|undefined|true|false)$/i.test(normalizedValue)) {
      return null;
    }

    if (/^\d{1,10}$/.test(normalizedValue)) {
      return null;
    }

    if (/^[\[{"]/.test(normalizedValue)) {
      const parsed = tryParseJson(normalizedValue);
      if (parsed.ok) {
        return normalizeBearerToken(parsed.value, depth + 1);
      }
    }

    return normalizedValue;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 10)) {
      const candidate = normalizeBearerToken(entry, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const prioritizedEntries = entries.filter(([key]) => TOKEN_WRAPPER_KEY_RE.test(key));
    const nestedEntries = entries.filter(([key, entryValue]) => !TOKEN_WRAPPER_KEY_RE.test(key) && entryValue && typeof entryValue === 'object');

    for (const [, entryValue] of prioritizedEntries) {
      const candidate = normalizeBearerToken(entryValue, depth + 1);
      if (candidate) {
        return candidate;
      }
    }

    for (const [, entryValue] of nestedEntries) {
      const candidate = normalizeBearerToken(entryValue, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function isRejectedBearerCandidate(candidate) {
  const keyPath = String(candidate?.keyPath || '').toLowerCase();
  const value = String(candidate?.value || '');
  const normalizedValue = value.toLowerCase();

  return keyPath.includes('aws_waf')
    || keyPath.includes('awswaf')
    || keyPath.includes('challenge')
    || keyPath.includes('captcha')
    || isRejectedBearerSource(keyPath)
    || (keyPath.includes('timestamp') && /^\d{8,}$/.test(value.trim()))
    || normalizedValue.includes('awswafintegration');
}

function selectBearerCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreBearerCandidate(candidate),
      normalizedValue: normalizeBearerToken(candidate.value)
    }))
    .filter((candidate) => candidate.normalizedValue)
    .filter((candidate) => !isRejectedBearerCandidate(candidate))
    .sort((left, right) => right.score - left.score);

  return ranked[0] || null;
}

function createCaptureResult(origin, profilePath) {
  return {
    ok: false,
    capturedAt: new Date().toISOString(),
    origin,
    profilePath,
    issues: [],
    recommendations: [],
    debug: {
      devToolsActivePort: null,
      devToolsReachable: false,
      browserVersion: null,
      browserWebSocketUrl: null,
      targetCount: 0,
      deepseekTarget: null,
      authPageDetected: false,
      authPageReason: null,
      challengeDetected: false,
      challengeReason: null
    },
    auth: {
      userAgent: null,
      cookieHeader: null,
      cookies: [],
      bearerToken: null,
      bearerSource: null,
      pageUrl: null,
      pageTitle: null,
      localStorageKeys: [],
      sessionStorageKeys: []
    }
  };
}

function addIssue(result, issue) {
  if (!result.issues.includes(issue)) {
    result.issues.push(issue);
  }
}

function addRecommendation(result, recommendation) {
  if (!result.recommendations.includes(recommendation)) {
    result.recommendations.push(recommendation);
  }
}

async function captureAuthState(options = {}) {
  const normalizedOrigin = normalizeOrigin(options.origin || DEFAULT_ORIGIN);
  const profilePath = resolveProfilePath(options.profilePath || options.profile || null);
  const result = createCaptureResult(normalizedOrigin.origin, profilePath);
  const devToolsInfo = readDevToolsActivePort(profilePath);
  result.debug.devToolsActivePort = devToolsInfo;

  if (!fs.existsSync(profilePath)) {
    addIssue(result, `Browser profile not found: ${profilePath}`);
    addRecommendation(result, `Launch Chromium with --user-data-dir=${profilePath} before onboarding DeepSeek Web auth.`);
    return result;
  }

  if (!devToolsInfo.exists) {
    addIssue(result, `DevToolsActivePort file is missing: ${devToolsInfo.filePath}`);
    addRecommendation(result, `Start Chromium with --remote-debugging-port=0 --user-data-dir=${profilePath}.`);
    return result;
  }

  if (!devToolsInfo.port || !devToolsInfo.browserPath) {
    addIssue(result, `DevToolsActivePort is malformed: ${devToolsInfo.filePath}`);
    addRecommendation(result, 'Relaunch the debug browser so Chromium rewrites DevToolsActivePort.');
    return result;
  }

  let version = null;
  let targets = [];
  try {
    version = await requestJson(`http://127.0.0.1:${devToolsInfo.port}/json/version`);
    targets = await requestJson(`http://127.0.0.1:${devToolsInfo.port}/json/list`);
    result.debug.devToolsReachable = true;
    result.debug.browserVersion = version.Browser || null;
    result.debug.browserWebSocketUrl = version.webSocketDebuggerUrl || devToolsInfo.browserWebSocketUrl;
    result.debug.targetCount = Array.isArray(targets) ? targets.length : 0;
  } catch (error) {
    addIssue(result, `DevTools endpoint is not reachable on 127.0.0.1:${devToolsInfo.port}: ${error.message}`);
    addRecommendation(result, 'Close stale Chromium processes and relaunch the workspace browser profile.');
    return result;
  }

  const deepseekTarget = Array.isArray(targets)
    ? targets.find((target) => target.type === 'page' && String(target.url || '').startsWith(normalizedOrigin.origin))
      || targets.find((target) => target.type === 'page' && String(target.url || '').includes(normalizedOrigin.host))
    : null;

  result.debug.deepseekTarget = deepseekTarget
    ? {
        id: deepseekTarget.id || null,
        title: deepseekTarget.title || '',
        url: deepseekTarget.url || '',
        webSocketDebuggerUrl: deepseekTarget.webSocketDebuggerUrl || null
      }
    : null;

  if (!deepseekTarget) {
    addIssue(result, `No open page target matched ${normalizedOrigin.origin}.`);
    addRecommendation(result, `Open ${normalizedOrigin.origin} in the debug browser and keep the tab loaded before rerunning onboarding.`);
  }

  try {
    const cookies = await fetchBrowserCookies(result.debug.browserWebSocketUrl);
    result.auth.cookies = cookies
      .filter((cookie) => isCookieRelevant(cookie, normalizedOrigin.host))
      .filter((cookie) => !isCookieExpired(cookie))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '',
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        sameSite: cookie.sameSite || 'Unknown',
        expires: typeof cookie.expires === 'number' ? cookie.expires : null
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    if (result.auth.cookies.length > 0) {
      result.auth.cookieHeader = buildCookieHeader(result.auth.cookies);
    } else {
      addIssue(result, `No ${normalizedOrigin.host} cookies were found in the attached browser profile.`);
      addRecommendation(result, `Log in to ${normalizedOrigin.origin} in the debug browser before onboarding.`);
    }
  } catch (error) {
    addIssue(result, `Failed to read browser cookies via CDP: ${error.message}`);
    addRecommendation(result, 'Keep the Chromium DevTools endpoint available while the onboarding script runs.');
  }

  if (deepseekTarget?.webSocketDebuggerUrl) {
    try {
      const pageState = await inspectDeepSeekTarget(deepseekTarget);
      result.auth.pageUrl = pageState?.href || deepseekTarget.url || null;
      result.auth.pageTitle = pageState?.title || deepseekTarget.title || null;
      result.auth.userAgent = pageState?.userAgent || version['User-Agent'] || null;
      result.auth.localStorageKeys = Array.isArray(pageState?.localStorageKeys) ? pageState.localStorageKeys : [];
      result.auth.sessionStorageKeys = Array.isArray(pageState?.sessionStorageKeys) ? pageState.sessionStorageKeys : [];
      result.debug.authPageDetected = Boolean(pageState?.authPageDetected);
      result.debug.authPageReason = pageState?.authPageReason || getAuthPageReason(pageState?.href) || null;
      result.debug.challengeDetected = Boolean(pageState?.challengeDetected);
      result.debug.challengeReason = pageState?.challengeReason || null;

      if (result.debug.authPageDetected) {
        addIssue(result, `DeepSeek page is on the sign-in/auth screen (${result.debug.authPageReason || 'auth_page_detected'}) instead of the authenticated chat app.`);
        addRecommendation(result, `Log in at ${normalizedOrigin.origin} with the workspace browser profile, wait until the chat composer is visible, then rerun onboarding.`);
      }

      if (result.debug.challengeDetected) {
        addIssue(result, `DeepSeek page is still on the AWS WAF challenge (${result.debug.challengeReason || 'challenge_detected'}) instead of the authenticated app.`);
        addRecommendation(result, `Open ${normalizedOrigin.origin} in the workspace browser profile, refresh until the full chat app loads, then rerun onboarding.`);
      }

      const bearerCandidate = result.debug.authPageDetected
        ? null
        : selectBearerCandidate(pageState?.tokenCandidates || []);
      if (bearerCandidate) {
        result.auth.bearerToken = bearerCandidate.normalizedValue;
        result.auth.bearerSource = `${bearerCandidate.source}:${bearerCandidate.keyPath}`;
      } else if (!result.debug.challengeDetected && !result.debug.authPageDetected) {
        addIssue(result, `No bearer-like token could be found in DeepSeek page storage for ${normalizedOrigin.origin}.`);
        addRecommendation(result, 'Keep the DeepSeek tab logged in and fully loaded so local/session storage is populated.');
      }
    } catch (error) {
      result.auth.userAgent = version['User-Agent'] || null;
      addIssue(result, `Failed to inspect the DeepSeek page target: ${error.message}`);
      addRecommendation(result, `Reload ${normalizedOrigin.origin} in the debug browser and rerun onboarding.`);
    }
  } else {
    result.auth.userAgent = version['User-Agent'] || null;
  }

  result.ok = Boolean(
    result.auth.userAgent
      && result.auth.cookieHeader
      && result.auth.bearerToken
      && !result.debug.authPageDetected
      && !result.debug.challengeDetected
  );
  return result;
}

function serializeAuthState(capture) {
  return {
    savedAt: new Date().toISOString(),
    origin: capture.origin,
    profilePath: capture.profilePath,
    capturedAt: capture.capturedAt,
    ready: capture.ok,
    auth: {
      userAgent: capture.auth.userAgent,
      cookieHeader: capture.auth.cookieHeader,
      cookies: capture.auth.cookies,
      bearerToken: capture.auth.bearerToken,
      bearerSource: capture.auth.bearerSource,
      pageUrl: capture.auth.pageUrl,
      pageTitle: capture.auth.pageTitle
    },
    debug: {
      browserVersion: capture.debug.browserVersion,
      targetCount: capture.debug.targetCount,
      deepseekTarget: capture.debug.deepseekTarget,
      authPageDetected: capture.debug.authPageDetected,
      authPageReason: capture.debug.authPageReason,
      challengeDetected: capture.debug.challengeDetected,
      challengeReason: capture.debug.challengeReason
    }
  };
}

function saveAuthState(capture, options = {}) {
  const storePath = resolveStorePath(options.storePath);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  const payload = serializeAuthState(capture);
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, storePath);
  fs.chmodSync(storePath, 0o600);

  return {
    storePath,
    payload
  };
}

function loadAuthState(options = {}) {
  const storePath = resolveStorePath(options.storePath);
  if (!fs.existsSync(storePath)) {
    return null;
  }

  const authState = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  if (!authState || typeof authState !== 'object' || !authState.auth || typeof authState.auth !== 'object') {
    return authState;
  }

  return {
    ...authState,
    auth: {
      ...authState.auth,
      bearerToken: normalizeBearerToken(authState.auth.bearerToken)
    }
  };
}

function clearAuthState(options = {}) {
  const storePath = resolveStorePath(options.storePath);
  safeUnlink(storePath);
}

function summarizeCapture(capture, options = {}) {
  const storePath = resolveStorePath(options.storePath);
  return {
    ok: capture.ok,
    origin: capture.origin,
    profilePath: capture.profilePath,
    capturedAt: capture.capturedAt,
    storePath,
    readyToPersist: capture.ok,
    debug: {
      devToolsActivePortFile: capture.debug.devToolsActivePort?.filePath || null,
      devToolsPort: capture.debug.devToolsActivePort?.port || null,
      devToolsReachable: capture.debug.devToolsReachable,
      browserVersion: capture.debug.browserVersion,
      targetCount: capture.debug.targetCount,
      deepseekTargetUrl: capture.debug.deepseekTarget?.url || null,
      authPageDetected: capture.debug.authPageDetected,
      authPageReason: capture.debug.authPageReason,
      challengeDetected: capture.debug.challengeDetected,
      challengeReason: capture.debug.challengeReason
    },
    auth: {
      userAgent: capture.auth.userAgent,
      cookieCount: capture.auth.cookies.length,
      cookieHeader: summarizeSecret(capture.auth.cookieHeader),
      bearerToken: summarizeSecret(capture.auth.bearerToken),
      bearerSource: capture.auth.bearerSource,
      pageUrl: capture.auth.pageUrl
    },
    issues: capture.issues.slice(),
    recommendations: capture.recommendations.slice()
  };
}

module.exports = {
  DEFAULT_ORIGIN,
  DEFAULT_PROFILE_PATH,
  DEFAULT_STORE_PATH,
  captureAuthState,
  clearAuthState,
  getAuthPageReason,
  isAuthPageUrl,
  isRejectedBearerSource,
  loadAuthState,
  readDevToolsActivePort,
  resolveProfilePath,
  saveAuthState,
  summarizeCapture,
  summarizeSecret
};
