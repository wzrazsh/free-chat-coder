#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { DEFAULT_STORE_PATH } = require('../queue-server/providers/deepseek-web/auth');
const deepseekWebProvider = require('../queue-server/providers/deepseek-web/client');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROMPT = 'Reply with exactly: FCC_DEEPSEEK_OK';

function resolveRepoPath(targetPath) {
  if (!targetPath) {
    return null;
  }

  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }

  return path.resolve(REPO_ROOT, targetPath);
}

function requireArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    prompt: DEFAULT_PROMPT,
    storePath: DEFAULT_STORE_PATH,
    baseUrl: null,
    endpointPaths: [],
    timeoutMs: null,
    model: null,
    headerArgs: [],
    requestBodyInput: null,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--prompt') {
      options.prompt = requireArgValue(argv, index, '--prompt');
      index += 1;
      continue;
    }

    if (arg.startsWith('--prompt=')) {
      options.prompt = arg.slice('--prompt='.length);
      continue;
    }

    if (arg === '--store-path') {
      options.storePath = requireArgValue(argv, index, '--store-path');
      index += 1;
      continue;
    }

    if (arg.startsWith('--store-path=')) {
      options.storePath = arg.slice('--store-path='.length);
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = requireArgValue(argv, index, '--base-url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg === '--endpoint-path') {
      options.endpointPaths.push(requireArgValue(argv, index, '--endpoint-path'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--endpoint-path=')) {
      options.endpointPaths.push(arg.slice('--endpoint-path='.length));
      continue;
    }

    if (arg === '--timeout-ms') {
      const rawValue = requireArgValue(argv, index, '--timeout-ms');
      options.timeoutMs = Number(rawValue);
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
      continue;
    }

    if (arg === '--model') {
      options.model = requireArgValue(argv, index, '--model');
      index += 1;
      continue;
    }

    if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length);
      continue;
    }

    if (arg === '--header') {
      options.headerArgs.push(requireArgValue(argv, index, '--header'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--header=')) {
      options.headerArgs.push(arg.slice('--header='.length));
      continue;
    }

    if (arg === '--request-body') {
      options.requestBodyInput = requireArgValue(argv, index, '--request-body');
      index += 1;
      continue;
    }

    if (arg.startsWith('--request-body=')) {
      options.requestBodyInput = arg.slice('--request-body='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) && options.timeoutMs != null) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  if (options.timeoutMs != null && options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return options;
}

function normalizeEndpointPaths(endpointPaths) {
  return endpointPaths
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('/') ? entry : `/${entry}`));
}

function parseHeaderArgs(headerArgs) {
  const headers = {};

  for (const rawHeader of headerArgs) {
    const separatorIndex = rawHeader.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid --header value: ${rawHeader}`);
    }

    const name = rawHeader.slice(0, separatorIndex).trim();
    const value = rawHeader.slice(separatorIndex + 1).trim();
    if (!name) {
      throw new Error(`Invalid --header value: ${rawHeader}`);
    }

    headers[name] = value;
  }

  return headers;
}

function parseRequestBodyInput(requestBodyInput) {
  if (!requestBodyInput) {
    return null;
  }

  const source = requestBodyInput.startsWith('@')
    ? fs.readFileSync(resolveRepoPath(requestBodyInput.slice(1)), 'utf8')
    : requestBodyInput;

  let parsed = null;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Failed to parse --request-body JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--request-body must be a JSON object');
  }

  return parsed;
}

function previewText(value, limit = 160) {
  if (!value) {
    return '';
  }

  const normalized = String(value)
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function safeInspectAuthState(storePath) {
  try {
    return deepseekWebProvider.inspectAuthState(storePath);
  } catch (error) {
    return {
      ready: false,
      storePath: resolveRepoPath(storePath || DEFAULT_STORE_PATH),
      reason: 'unreadable_snapshot',
      missing: [],
      capturedAt: null,
      pageUrl: null,
      error: error.message || String(error)
    };
  }
}

function buildTask(options) {
  const endpointPaths = normalizeEndpointPaths(options.endpointPaths);
  const headers = parseHeaderArgs(options.headerArgs);
  const requestBody = parseRequestBodyInput(options.requestBodyInput);
  const deepseekWeb = {};

  if (options.baseUrl) {
    deepseekWeb.baseUrl = options.baseUrl;
  }
  if (endpointPaths.length > 0) {
    deepseekWeb.endpointPaths = endpointPaths;
  }
  if (options.timeoutMs != null) {
    deepseekWeb.timeoutMs = options.timeoutMs;
  }
  if (options.model) {
    deepseekWeb.model = options.model;
  }
  if (Object.keys(headers).length > 0) {
    deepseekWeb.headers = headers;
  }
  if (requestBody) {
    deepseekWeb.requestBody = requestBody;
  }

  return {
    task: {
      id: `deepseek-web-probe-${Date.now()}`,
      prompt: options.prompt,
      options: {
        provider: 'deepseek-web',
        authStorePath: options.storePath,
        deepseekWeb
      }
    },
    requestSummary: {
      promptPreview: previewText(options.prompt, 120),
      storePath: null,
      baseUrl: options.baseUrl || null,
      endpointPaths,
      timeoutMs: options.timeoutMs || null,
      model: options.model || null,
      headerNames: Object.keys(headers),
      requestBodyKeys: requestBody ? Object.keys(requestBody) : []
    }
  };
}

function summarizeError(error) {
  const details = error?.details && typeof error.details === 'object'
    ? error.details
    : {};

  return {
    code: error?.code || null,
    message: error?.message || String(error),
    statusCode: error?.statusCode || details.statusCode || null,
    stage: details.stage || null,
    endpointPath: details.endpointPath || null,
    contentType: details.contentType || null,
    reason: details.reason || null,
    storePath: details.storePath || null,
    missing: Array.isArray(details.missing) ? details.missing : [],
    bodyPreview: details.bodyPreview || null
  };
}

function buildResultSummary(result, durationMs) {
  return {
    ok: true,
    durationMs,
    endpointPath: result.endpointPath || null,
    responseMode: result.responseMode || null,
    providerSessionId: result.providerSessionId || null,
    providerParentMessageId: result.providerParentMessageId || null,
    providerMessageId: result.providerMessageId || null,
    requestId: result.requestId || null,
    textPreview: previewText(result.text, 240)
  };
}

function buildFailureSummary(error, durationMs) {
  return {
    ok: false,
    durationMs,
    error: summarizeError(error)
  };
}

function buildNextSteps(authSummary, failureSummary) {
  const suggestions = [];
  const errorCode = failureSummary?.error?.code || null;
  const statusCode = failureSummary?.error?.statusCode || null;

  if (!authSummary.ready) {
    suggestions.push('Run `node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser` and log in with the workspace browser profile if auth is still missing.');
  }

  if (statusCode === 404 || statusCode === 405) {
    suggestions.push('Retry with an explicit `--endpoint-path` that matches the current DeepSeek Web request URL.');
  }

  if (errorCode === 'DEEPSEEK_RESPONSE_EMPTY') {
    suggestions.push('Retry with `--request-body @path/to/body.json` if the live DeepSeek request contract now requires extra payload fields.');
  }

  if (errorCode === 'DEEPSEEK_HTTP_ERROR' || errorCode === 'DEEPSEEK_RESPONSE_EMPTY') {
    suggestions.push('If the probe still fails, compare the browser network request with `queue-server/providers/deepseek-web/client.js` and update the request contract before switching more traffic.');
  }

  return suggestions.filter((value, index, list) => list.indexOf(value) === index);
}

function printUsage() {
  console.log('Usage: node scripts/verify-deepseek-web-provider.js [options]\n');
  console.log('Options:');
  console.log(`  --prompt <text>          Probe prompt (default: ${DEFAULT_PROMPT})`);
  console.log(`  --store-path <path>      Auth snapshot path (default: ${DEFAULT_STORE_PATH})`);
  console.log('  --base-url <url>         Override the DeepSeek Web base URL');
  console.log('  --endpoint-path <path>   Override endpoint path; may be repeated');
  console.log('  --timeout-ms <n>         Override request timeout in milliseconds');
  console.log('  --model <name>           Inject a model field when the request body does not already set one');
  console.log('  --header "K: V"          Add an extra request header; may be repeated');
  console.log('  --request-body <json>    JSON object template, or @relative/path/to/body.json');
  console.log('  --json                   Print machine-readable JSON output');
  console.log('  --help                   Show this help message');
}

function printHumanSummary(summary) {
  console.log('DeepSeek Web Provider Probe');
  console.log('');
  console.log(`Auth snapshot: ${summary.auth.ready ? 'ready' : 'not ready'}`);
  console.log(`Store: ${summary.auth.storePath}`);
  if (summary.auth.capturedAt) {
    console.log(`Captured at: ${summary.auth.capturedAt}`);
  }
  if (summary.auth.pageUrl) {
    console.log(`Page: ${summary.auth.pageUrl}`);
  }
  if (!summary.auth.ready) {
    console.log(`Auth issue: ${summary.auth.reason || 'snapshot unavailable'}`);
    if (summary.auth.missing.length > 0) {
      console.log(`Missing: ${summary.auth.missing.join(', ')}`);
    }
    if (summary.auth.error) {
      console.log(`Snapshot error: ${summary.auth.error}`);
    }
  }

  console.log(`Prompt: ${summary.request.promptPreview || '(empty)'}`);
  console.log(`Base URL: ${summary.request.baseUrl || 'provider default'}`);
  console.log(`Endpoint paths: ${summary.request.endpointPaths.length > 0 ? summary.request.endpointPaths.join(', ') : 'provider default'}`);
  if (summary.request.timeoutMs) {
    console.log(`Timeout: ${summary.request.timeoutMs}ms`);
  }
  if (summary.request.model) {
    console.log(`Model override: ${summary.request.model}`);
  }
  if (summary.request.headerNames.length > 0) {
    console.log(`Extra headers: ${summary.request.headerNames.join(', ')}`);
  }
  if (summary.request.requestBodyKeys.length > 0) {
    console.log(`Request body keys: ${summary.request.requestBodyKeys.join(', ')}`);
  }

  console.log('');
  if (summary.probe.ok) {
    console.log(`Probe: success in ${summary.probe.durationMs}ms`);
    console.log(`Endpoint: ${summary.probe.endpointPath || '(unknown)'}`);
    console.log(`Response mode: ${summary.probe.responseMode || 'unknown'}`);
    if (summary.probe.providerSessionId) {
      console.log(`Session ID: ${summary.probe.providerSessionId}`);
    }
    if (summary.probe.providerMessageId) {
      console.log(`Message ID: ${summary.probe.providerMessageId}`);
    }
    if (summary.probe.requestId) {
      console.log(`Request ID: ${summary.probe.requestId}`);
    }
    console.log(`Reply preview: ${summary.probe.textPreview || '(empty)'}`);
    return;
  }

  console.log(`Probe: failed in ${summary.probe.durationMs}ms`);
  if (summary.probe.error.code) {
    console.log(`Error: ${summary.probe.error.code}`);
  }
  console.log(`Message: ${summary.probe.error.message}`);
  if (summary.probe.error.stage) {
    console.log(`Stage: ${summary.probe.error.stage}`);
  }
  if (summary.probe.error.statusCode) {
    console.log(`HTTP status: ${summary.probe.error.statusCode}`);
  }
  if (summary.probe.error.endpointPath) {
    console.log(`Endpoint: ${summary.probe.error.endpointPath}`);
  }
  if (summary.probe.error.bodyPreview) {
    console.log(`Body preview: ${summary.probe.error.bodyPreview}`);
  }

  if (summary.nextSteps.length > 0) {
    console.log('');
    console.log('Next Steps:');
    summary.nextSteps.forEach((step) => {
      console.log(`- ${step}`);
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const authSummary = safeInspectAuthState(options.storePath);
  const { task, requestSummary } = buildTask(options);
  requestSummary.storePath = authSummary.storePath;

  const startedAt = Date.now();
  let summary = null;

  try {
    const result = await deepseekWebProvider.executeTextTask(task);
    summary = {
      ok: true,
      auth: authSummary,
      request: requestSummary,
      probe: buildResultSummary(result, Date.now() - startedAt),
      nextSteps: []
    };
  } catch (error) {
    const failureSummary = buildFailureSummary(error, Date.now() - startedAt);
    summary = {
      ok: false,
      auth: authSummary,
      request: requestSummary,
      probe: failureSummary,
      nextSteps: buildNextSteps(authSummary, failureSummary)
    };
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHumanSummary(summary);
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
