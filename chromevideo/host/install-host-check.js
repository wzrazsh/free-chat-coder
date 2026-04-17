const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  autoDetectExtensionId,
  detectExtensionIdFromPreferencesFile,
  detectExtensionIdFromProfile,
  getLinuxManifestTargets,
  isValidExtensionId,
  parseArgs
} = require('./install_host');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'free-chat-coder-install-host-'));
}

function writePreferences(profilePath, extensionPath, extensionId) {
  const targetDir = path.join(profilePath, 'Default');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'Preferences'), JSON.stringify({
    extensions: {
      settings: {
        [extensionId]: {
          path: extensionPath
        },
        ahfgeienlihckogmohjhadlkjgocpleb: {
          path: '/tmp/other-extension'
        }
      }
    }
  }), 'utf8');
}

function testParseArgs() {
  const options = parseArgs([
    '--extension-id', 'abcdefghijklmnopabcdefghijklmnop',
    '--profile=/tmp/example',
    '--auto-detect'
  ]);

  assert.deepStrictEqual(options, {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    profile: '/tmp/example',
    autoDetect: true,
    help: false
  });
}

function testExtensionIdValidation() {
  assert.strictEqual(isValidExtensionId('abcdefghijklmnopabcdefghijklmnop'), true);
  assert.strictEqual(isValidExtensionId('ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP'), false);
  assert.strictEqual(isValidExtensionId('abc'), false);
}

function testDetectExtensionIdFromPreferencesFile() {
  const tempDir = makeTempDir();
  const extensionPath = path.join(tempDir, 'chromevideo');
  const profilePath = path.join(tempDir, 'profile');
  const extensionId = 'danbceiadlmbkkodhkolmffnhhkicbfi';

  fs.mkdirSync(extensionPath, { recursive: true });
  writePreferences(profilePath, extensionPath, extensionId);

  const detected = detectExtensionIdFromPreferencesFile(
    path.join(profilePath, 'Default', 'Preferences'),
    extensionPath
  );

  assert.deepStrictEqual(detected, {
    extensionId,
    preferencesPath: path.join(profilePath, 'Default', 'Preferences')
  });
}

function testDetectExtensionIdFromProfile() {
  const tempDir = makeTempDir();
  const extensionPath = path.join(tempDir, 'chromevideo');
  const profilePath = path.join(tempDir, 'custom-profile');
  const extensionId = 'fpiggepgljafdfddlpelhfdbckkbdijb';

  fs.mkdirSync(extensionPath, { recursive: true });
  writePreferences(profilePath, extensionPath, extensionId);

  const detected = detectExtensionIdFromProfile(profilePath, extensionPath);

  assert.deepStrictEqual(detected, {
    extensionId,
    preferencesPath: path.join(profilePath, 'Default', 'Preferences')
  });
}

function testAutoDetectExtensionIdFromExplicitProfile() {
  const tempDir = makeTempDir();
  const extensionPath = path.join(tempDir, 'chromevideo');
  const profilePath = path.join(tempDir, 'profile');
  const extensionId = 'danbceiadlmbkkodhkolmffnhhkicbfi';

  fs.mkdirSync(extensionPath, { recursive: true });
  writePreferences(profilePath, extensionPath, extensionId);

  const detected = autoDetectExtensionId(profilePath, extensionPath);

  assert.deepStrictEqual(detected, {
    extensionId,
    preferencesPath: path.join(profilePath, 'Default', 'Preferences'),
    profilePath: path.resolve(profilePath)
  });
}

function testLinuxManifestTargetsIncludeProjectProfile() {
  const targets = getLinuxManifestTargets();

  assert(targets.some((target) => target.includes(path.join('.browser-profile', 'NativeMessagingHosts'))));
  assert(targets.some((target) => target.includes(path.join('google-chrome-for-testing', 'NativeMessagingHosts'))));
}

function main() {
  testParseArgs();
  testExtensionIdValidation();
  testDetectExtensionIdFromPreferencesFile();
  testDetectExtensionIdFromProfile();
  testAutoDetectExtensionIdFromExplicitProfile();
  testLinuxManifestTargetsIncludeProjectProfile();
  console.log('install host checks passed');
}

main();
