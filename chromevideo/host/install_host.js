const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
  
  const manifest = {
    "name": "com.trae.freechatcoder.host",
    "description": "SOLO Coder Local Server Host",
    "path": "host.bat",
    "type": "stdio",
    "allowed_origins": [
      `chrome-extension://${extId}/`
    ]
  };

  const jsonPath = path.join(__dirname, 'com.trae.freechatcoder.host.json');
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nCreated: ${jsonPath}`);

  // Create host.bat
  const batPath = path.join(__dirname, 'host.bat');
  fs.writeFileSync(batPath, `@echo off\nnode "%~dp0host.js"\n`, 'utf8');
  console.log(`Created: ${batPath}`);

  // Register in Windows Registry
  const regCommand = `REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.trae.freechatcoder.host" /ve /t REG_SZ /d "${jsonPath}" /f`;
  try {
    cp.execSync(regCommand);
    console.log("\nSuccess: Registered Native Messaging Host in Windows Registry.");
    console.log("You can now click the Extension Popup to control the servers!");
  } catch (e) {
    console.error("\nFailed to register in Windows Registry.", e.message);
  }

  rl.close();
});
