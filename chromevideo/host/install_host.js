const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const readline = require('readline');

const HOST_NAME = 'com.trae.freechatcoder.host';
const HOST_DIR = __dirname;
const HOST_MANIFEST = path.join(HOST_DIR, `${HOST_NAME}.json`);
const HOST_BAT = path.join(HOST_DIR, 'host.bat');
const HOST_SH = path.join(HOST_DIR, 'host.sh');
const NODE_BIN = process.execPath;
const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function writeWindowsLauncher() {
  fs.writeFileSync(HOST_BAT, `@echo off\r\n"${NODE_BIN}" "%~dp0host.js"\r\n`, 'utf8');
  return HOST_BAT;
}

function writeLinuxLauncher() {
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    `exec "${NODE_BIN}" "$SCRIPT_DIR/host.js"`
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

  try {
    cp.execSync(regCommand);
    console.log('\nSuccess: Registered Native Messaging Host in Windows Registry.');
    console.log('You can now click the Extension Popup to control the servers!');
  } catch (error) {
    console.error('\nFailed to register in Windows Registry.', error.message);
    process.exitCode = 1;
  }
}

function getLinuxManifestTargets() {
  const home = os.homedir();
  return Array.from(new Set([
    path.join(home, '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`),
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
  console.log('\nLinux setup complete. Reload the extension if Chrome was already open.');
}

console.log("=========================================");
console.log("  SOLO Coder Native Host Setup");
console.log("=========================================\n");

console.log("1. Open Chrome and go to chrome://extensions");
console.log("2. Ensure 'Developer mode' is enabled (top right)");
console.log("3. Click 'Load unpacked' and select the 'chromevideo' directory");
console.log("4. Find the 'ID' of the 'DeepSeek Agent Bridge' extension.\n");

rl.question("Please enter the Extension ID: ", (extId) => {
  extId = extId.trim();
  if (!extId || extId.length !== 32) {
    console.log("Invalid Extension ID. It should be 32 characters long. Exiting.");
    process.exit(1);
  }
  
  let hostPath;
  if (IS_WINDOWS) {
    hostPath = writeWindowsLauncher();
    console.log(`Created: ${HOST_BAT}`);
  } else if (IS_LINUX) {
    hostPath = writeLinuxLauncher();
    console.log(`Created: ${HOST_SH}`);
  } else {
    console.log(`Unsupported platform: ${process.platform}. Currently only Windows and Linux are supported.`);
    process.exit(1);
    return;
  }

  const manifest = {
    name: HOST_NAME,
    description: "SOLO Coder Local Server Host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [
      `chrome-extension://${extId}/`
    ]
  };

  writeManifestFile(HOST_MANIFEST, manifest);
  console.log(`\nCreated: ${HOST_MANIFEST}`);

  if (IS_WINDOWS) {
    installWindowsManifest(HOST_MANIFEST);
  } else if (IS_LINUX) {
    installLinuxManifest(manifest);
  }

  rl.close();
});
