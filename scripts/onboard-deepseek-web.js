#!/usr/bin/env node

const path = require('path');

const {
  DEFAULT_ORIGIN,
  DEFAULT_STORE_PATH,
  captureAuthState,
  saveAuthState,
  summarizeCapture
} = require('../queue-server/providers/deepseek-web/auth');

function parseArgs(argv) {
  const options = {
    profile: null,
    origin: DEFAULT_ORIGIN,
    storePath: DEFAULT_STORE_PATH,
    json: false,
    noStore: false,
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

    if (arg === '--no-store') {
      options.noStore = true;
      continue;
    }

    if (arg === '--profile') {
      options.profile = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
      continue;
    }

    if (arg === '--origin') {
      options.origin = argv[index + 1] || DEFAULT_ORIGIN;
      index += 1;
      continue;
    }

    if (arg.startsWith('--origin=')) {
      options.origin = arg.slice('--origin='.length);
      continue;
    }

    if (arg === '--store-path') {
      options.storePath = argv[index + 1] || DEFAULT_STORE_PATH;
      index += 1;
      continue;
    }

    if (arg.startsWith('--store-path=')) {
      options.storePath = arg.slice('--store-path='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log('Usage: node scripts/onboard-deepseek-web.js [options]\n');
  console.log('Options:');
  console.log('  --profile <path>     Chromium/Chrome profile to inspect (defaults to .browser-profile)');
  console.log(`  --origin <url>       DeepSeek origin to inspect (default: ${DEFAULT_ORIGIN})`);
  console.log(`  --store-path <path>  Local auth snapshot path (default: ${DEFAULT_STORE_PATH})`);
  console.log('  --no-store           Do not persist the captured auth state');
  console.log('  --json               Print a JSON summary instead of human-readable output');
  console.log('  --help               Show this help message');
}

function printHumanSummary(summary, storeStatus) {
  console.log('DeepSeek Web Zero-Token Onboarding');
  console.log('');
  console.log(`Ready: ${summary.ok ? 'yes' : 'no'}`);
  console.log(`Profile: ${summary.profilePath}`);
  console.log(`Origin: ${summary.origin}`);
  console.log(`DevTools: ${summary.debug.devToolsReachable ? `reachable on ${summary.debug.devToolsPort}` : 'unavailable'}`);
  console.log(`DeepSeek page: ${summary.debug.deepseekTargetUrl || 'not found'}`);
  console.log(`User-Agent: ${summary.auth.userAgent || 'missing'}`);
  console.log(`Cookies: ${summary.auth.cookieCount} ${summary.auth.cookieHeader.present ? `(fingerprint ${summary.auth.cookieHeader.fingerprint})` : ''}`.trim());
  console.log(`Bearer: ${summary.auth.bearerToken.present ? `captured from ${summary.auth.bearerSource || 'unknown source'} (${summary.auth.bearerToken.fingerprint})` : 'missing'}`);

  if (storeStatus.skipped) {
    console.log(`Store: skipped (${storeStatus.reason})`);
  } else if (storeStatus.saved) {
    console.log(`Store: wrote ${storeStatus.storePath}`);
  }

  if (summary.issues.length > 0) {
    console.log('');
    console.log('Issues:');
    summary.issues.forEach((issue) => {
      console.log(`- ${issue}`);
    });
  }

  if (summary.recommendations.length > 0) {
    console.log('');
    console.log('Next Steps:');
    summary.recommendations.forEach((recommendation) => {
      console.log(`- ${recommendation}`);
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const capture = await captureAuthState({
    profilePath: options.profile,
    origin: options.origin
  });

  let storeStatus = {
    saved: false,
    skipped: false,
    storePath: path.resolve(options.storePath)
  };

  if (options.noStore) {
    storeStatus = {
      ...storeStatus,
      skipped: true,
      reason: '--no-store'
    };
  } else if (!capture.ok) {
    storeStatus = {
      ...storeStatus,
      skipped: true,
      reason: 'capture incomplete'
    };
  } else {
    const stored = saveAuthState(capture, {
      storePath: options.storePath
    });
    storeStatus = {
      saved: true,
      skipped: false,
      storePath: stored.storePath
    };
  }

  const summary = summarizeCapture(capture, {
    storePath: options.storePath
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ...summary,
      store: storeStatus
    }, null, 2)}\n`);
    return;
  }

  printHumanSummary(summary, storeStatus);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
