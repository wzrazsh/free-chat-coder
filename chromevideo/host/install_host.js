const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const readline = require('readline');

const HOST_NAME = 'com.trae.freechatcoder.host';
const HOST_DIR = __dirname;
const EXTENSION_DIR = path.resolve(HOST_DIR, '..');
const WORKSPACE_DIR = path.resolve(HOST_DIR, '../..');
const HOST_MANIFEST = path.join(HOST_DIR, `${HOST_NAME}.json`);
const HOST_BAT = path.join(HOST_DIR, 'host.bat');
const HOST_SH = path.join(HOST_DIR, 'host.sh');
const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

function printBanner() {
  console.log('=========================================');
  console.log('  SOLO Coder Native Host Setup');
  console.log('=========================================\n');
}

function printUsage() {
  console.log('Usage: node chromevideo/host/install_host.js [options]\n');
  console.log('Options:');
  console.log('  --extension-id <id>  Use a specific unpacked extension ID');
  console.log('  --profile <path>     Auto-detect the extension ID from a browser profile');
  console.log('  --auto-detect        Require profile-based auto-detection instead of prompting');
  console.log('  --help               Show this help message');
}

function printInteractiveInstructions() {
  console.log('1. Open Chrome/Chromium and go to chrome://extensions');
  console.log("2. Ensure 'Developer mode' is enabled");
  console.log("3. Load the 'chromevideo' directory as an unpacked extension");
  console.log("4. Copy the current 'DeepSeek Agent Bridge' extension ID\n");
}

function isValidExtensionId(extId) {
  return /^[a-p]{32}$/.test(extId);
}

function normalizePathForMatch(targetPath) {
  if (!targetPath) {
    return null;
  }

  const resolved = path.resolve(targetPath);
  return IS_WINDOWS ? resolved.toLowerCase() : resolved;
}

function getPreferenceFileCandidates(profilePath) {
  const resolved = path.resolve(profilePath);
  const candidates = [];

  if (path.basename(resolved) === 'Default') {
    candidates.push(path.join(resolved, 'Preferences'));
  } else {
    candidates.push(path.join(resolved, 'Default', 'Preferences'));
    candidates.push(path.join(resolved, 'Preferences'));
  }

  return Array.from(new Set(candidates));
}

function detectExtensionIdFromPreferencesFile(preferencesPath, extensionPath = EXTENSION_DIR) {
  const raw = fs.readFileSync(preferencesPath, 'utf8');
  const data = JSON.parse(raw);
  const settings = data?.extensions?.settings;

  if (!settings || typeof settings !== 'object') {
    return null;
  }

  const expectedPath = normalizePathForMatch(extensionPath);
  const matches = Object.entries(settings)
    .filter(([id, entry]) => isValidExtensionId(id) && normalizePathForMatch(entry?.path) === expectedPath)
    .map(([id]) => id);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(`Multiple matching extension IDs found in ${preferencesPath}: ${matches.join(', ')}`);
  }

  return {
    extensionId: matches[0],
    preferencesPath
  };
}

function getDefaultProfileCandidates() {
  const home = os.homedir();
  return Array.from(new Set([
    path.join(WORKSPACE_DIR, '.browser-profile'),
    path.join(home, '.config/chromium'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/google-chrome-for-testing'),
    path.join(home, '.config/google-chrome-beta'),
    path.join(home, '.config/google-chrome-unstable'),
    path.join(home, '.config/BraveSoftware/Brave-Browser'),
    path.join(home, '.var/app/com.google.Chrome/config/google-chrome'),
    path.join(home, '.var/app/org.chromium.Chromium/config/chromium'),
    path.join(home, 'snap/chromium/current/.config/chromium')
  ]));
}

function detectExtensionIdFromProfile(profilePath, extensionPath = EXTENSION_DIR) {
  for (const preferencesPath of getPreferenceFileCandidates(profilePath)) {
    if (!fs.existsSync(preferencesPath)) {
      continue;
    }

    const detected = detectExtensionIdFromPreferencesFile(preferencesPath, extensionPath);
    if (detected) {
      return detected;
    }
  }

  return null;
}

function autoDetectExtensionId(profilePath, extensionPath = EXTENSION_DIR) {
  const profileCandidates = profilePath
    ? [profilePath]
    : getDefaultProfileCandidates();

  for (const candidate of profileCandidates) {
    const detected = detectExtensionIdFromProfile(candidate, extensionPath);
    if (detected) {
      return {
        ...detected,
        profilePath: path.resolve(candidate)
      };
    }
  }

  return null;
}

function parseArgs(argv) {
  const options = {
    extensionId: null,
    profile: null,
    autoDetect: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--auto-detect') {
      options.autoDetect = true;
      continue;
    }

    if (arg === '--extension-id') {
      options.extensionId = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--extension-id=')) {
      options.extensionId = arg.slice('--extension-id='.length);
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function writeWindowsLauncher() {
  fs.writeFileSync(HOST_BAT, '@echo off\r\nnode "%~dp0host.js"\r\n', 'utf8');
  return HOST_BAT;
}

function writeLinuxLauncher() {
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'exec node "$SCRIPT_DIR/host.js"'
  ].join('\n') + '\n';

  fs.writeFileSync(HOST_SH, script, 'utf8');
  fs.chmodSync(HOST_SH, 0o755);
  return HOST_SH;
}

function writeManifestFile(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function installWindowsManifest(jsonPath) {
  const regCommand = `REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /ve /t REG_SZ /d "${jsonPath}" /f`;

  cp.execSync(regCommand);
  console.log('\nSuccess: registered Native Messaging Host in Windows Registry.');
}

function getLinuxManifestTargets() {
  const home = os.homedir();
  return Array.from(new Set([
    path.join(WORKSPACE_DIR, '.browser-profile', 'NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/google-chrome-for-testing/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/chromium/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/google-chrome-beta/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/google-chrome-unstable/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, '.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts', `${HOST_NAME}.json`),
    path.join(home, 'snap/chromium/current/.config/chromium/NativeMessagingHosts', `${HOST_NAME}.json`)
  ]));
}

function installLinuxManifest(manifest) {
  const targets = getLinuxManifestTargets();
  for (const target of targets) {
    writeManifestFile(target, manifest);
  }

  console.log('\nInstalled Native Messaging manifest to:');
  for (const target of targets) {
    console.log(`- ${target}`);
  }
}

function buildManifest(extensionId, launcherPath) {
  return {
    name: HOST_NAME,
    description: 'SOLO Coder Local Server Host',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${extensionId}/`
    ]
  };
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function resolveExtensionId(options = {}) {
  if (options.extensionId) {
    if (!isValidExtensionId(options.extensionId.trim())) {
      throw new Error('Invalid extension ID. It must be 32 characters using letters a-p.');
    }

    return {
      extensionId: options.extensionId.trim(),
      source: 'cli'
    };
  }

  const detected = autoDetectExtensionId(options.profile || null);
  if (detected) {
    return {
      extensionId: detected.extensionId,
      preferencesPath: detected.preferencesPath,
      profilePath: detected.profilePath,
      source: 'auto-detect'
    };
  }

  if (options.autoDetect || !process.stdin.isTTY) {
    const profileHint = options.profile
      ? ` from profile ${path.resolve(options.profile)}`
      : ' from known browser profiles';
    throw new Error(`Failed to auto-detect the extension ID${profileHint}. Use --extension-id <id> or load the unpacked extension first.`);
  }

  printInteractiveInstructions();
  const extId = (await prompt('Please enter the Extension ID: ')).trim();

  if (!isValidExtensionId(extId)) {
    throw new Error('Invalid extension ID. It must be 32 characters using letters a-p.');
  }

  return {
    extensionId: extId,
    source: 'prompt'
  };
}

async function installHost(options = {}) {
  if (options.help) {
    printUsage();
    return {
      ok: true,
      skipped: true
    };
  }

  printBanner();

  const resolved = await resolveExtensionId(options);
  console.log(`Using Extension ID: ${resolved.extensionId}`);

  if (resolved.source === 'auto-detect') {
    console.log(`Detected from: ${resolved.preferencesPath}`);
  }

  let launcherPath;
  if (IS_WINDOWS) {
    launcherPath = writeWindowsLauncher();
    console.log(`Created: ${HOST_BAT}`);
  } else if (IS_LINUX) {
    launcherPath = writeLinuxLauncher();
    console.log(`Prepared: ${HOST_SH}`);
  } else {
    throw new Error(`Unsupported platform: ${process.platform}. Currently only Windows and Linux are supported.`);
  }

  const manifest = buildManifest(resolved.extensionId, launcherPath);

  if (IS_WINDOWS) {
    writeManifestFile(HOST_MANIFEST, manifest);
    console.log(`Created: ${HOST_MANIFEST}`);
    installWindowsManifest(HOST_MANIFEST);
  } else {
    installLinuxManifest(manifest);
  }

  console.log('\nNative Host setup complete. Reload the extension if Chromium is already open.');

  return {
    ok: true,
    extensionId: resolved.extensionId,
    launcherPath,
    manifestPath: HOST_MANIFEST,
    source: resolved.source
  };
}

if (require.main === module) {
  installHost(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  HOST_NAME,
  EXTENSION_DIR,
  HOST_MANIFEST,
  buildManifest,
  autoDetectExtensionId,
  detectExtensionIdFromPreferencesFile,
  detectExtensionIdFromProfile,
  getDefaultProfileCandidates,
  getLinuxManifestTargets,
  getPreferenceFileCandidates,
  installHost,
  isValidExtensionId,
  normalizePathForMatch,
  parseArgs,
  resolveExtensionId
};
