const fs = require('fs');
const path = require('path');
const config = require('../shared/config');

const chromevideoPath = path.join(__dirname, '../chromevideo');
const preferredPort = Number(config.queueServer.preferredPort || config.queueServer.port || 8080);

function writeFileIfChanged(filePath, nextContent) {
  const currentContent = fs.readFileSync(filePath, 'utf8');
  if (currentContent !== nextContent) {
    fs.writeFileSync(filePath, nextContent);
  }
}

const popupPath = path.join(chromevideoPath, 'popup.html');
const popupContent = fs.readFileSync(popupPath, 'utf8').replace(
  /Queue Server \(Port [^)]+\)/,
  `Queue Server (Port ${preferredPort}+)`
);
writeFileIfChanged(popupPath, popupContent);

const sidepanelPath = path.join(chromevideoPath, 'sidepanel.html');
const sidepanelContent = fs.readFileSync(sidepanelPath, 'utf8').replace(
  /<span class="port-tag" id="queue-port-tag">:[^<]+<\/span>/,
  `<span class="port-tag" id="queue-port-tag">:${preferredPort}+</span>`
);
writeFileIfChanged(sidepanelPath, sidepanelContent);

const manifestPath = path.join(chromevideoPath, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const hostPermissions = new Set(manifest.host_permissions || []);
hostPermissions.add('http://localhost/*');
manifest.host_permissions = Array.from(hostPermissions);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Synchronized extension defaults with shared/config.js (preferred queue port ${preferredPort}+).`);
