const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  autoDetectExtensionId,
  detectExtensionIdFromPreferencesFile,
  detectExtensionIdFromProfile,
  findInstalledManifestFiles,
  getDefaultProfileCandidatesForWorkspace,
  getLinuxManifestTargets,
  getLinuxManifestTargetsForWorkspace,
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

function testWorkspaceProfileCandidatesPreferWorkspaceProfile() {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const candidates = getDefaultProfileCandidatesForWorkspace(tempDir, homeDir);

  assert.strictEqual(candidates[0], path.join(tempDir, '.browser-profile'));
  assert(candidates.includes(path.join(homeDir, '.config/chromium')));
}

function testLinuxManifestTargetsIncludeProjectProfile() {
  const targets = getLinuxManifestTargets();

  assert(targets.some((target) => target.includes(path.join('.browser-profile', 'NativeMessagingHosts'))));
  assert(targets.some((target) => target.includes(path.join('google-chrome-for-testing', 'NativeMessagingHosts'))));
}

function testLinuxManifestTargetsForWorkspace() {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const targets = getLinuxManifestTargetsForWorkspace(tempDir, homeDir);

  assert(targets.includes(path.join(tempDir, '.browser-profile', 'NativeMessagingHosts', 'com.trae.freechatcoder.host.json')));
  assert(targets.includes(path.join(homeDir, '.config/google-chrome/NativeMessagingHosts', 'com.trae.freechatcoder.host.json')));
}

function testFindInstalledManifestFiles() {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const target = path.join(tempDir, '.browser-profile', 'NativeMessagingHosts', 'com.trae.freechatcoder.host.json');

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{}', 'utf8');

  const found = findInstalledManifestFiles({
    workspaceDir: tempDir,
    homeDir,
    platform: 'linux'
  });

  assert.deepStrictEqual(found, [target]);
}

function main() {
  testParseArgs();
  testExtensionIdValidation();
  testDetectExtensionIdFromPreferencesFile();
  testDetectExtensionIdFromProfile();
  testAutoDetectExtensionIdFromExplicitProfile();
  testWorkspaceProfileCandidatesPreferWorkspaceProfile();
  testLinuxManifestTargetsIncludeProjectProfile();
  testLinuxManifestTargetsForWorkspace();
  testFindInstalledManifestFiles();
  console.log('install host checks passed');
}

main();
