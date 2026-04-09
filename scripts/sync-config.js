const fs = require('fs');
const path = require('path');
const config = require('../shared/config');

const chromevideoPath = path.join(__dirname, '../chromevideo');

// Update offscreen.js
const offscreenPath = path.join(chromevideoPath, 'offscreen.js');
let offscreenContent = fs.readFileSync(offscreenPath, 'utf8');
offscreenContent = offscreenContent.replace(/const WS_URL = 'ws:\/\/[^']+';/, `const WS_URL = 'ws://${config.queueServer.host}:${config.queueServer.port}';`);
fs.writeFileSync(offscreenPath, offscreenContent);

// Update manifest.json
const manifestPath = path.join(chromevideoPath, 'manifest.json');
let manifestContent = fs.readFileSync(manifestPath, 'utf8');
manifestContent = manifestContent.replace(/"http:\/\/[^/]+\/\*"/, `"http://${config.queueServer.host}:${config.queueServer.port}/*"`);
fs.writeFileSync(manifestPath, manifestContent);

console.log('Synchronized chromevideo config with shared/config.js');
