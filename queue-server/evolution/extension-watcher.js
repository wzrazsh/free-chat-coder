const fs = require('fs');
const path = require('path');
const { broadcastToExtensions } = require('../websocket/handler');

const extensionDir = path.join(__dirname, '..', '..', 'chromevideo');

function watchExtension() {
  if (!fs.existsSync(extensionDir)) {
    console.log('[Watcher] Extension directory not found:', extensionDir);
    return;
  }

  let debounceTimer;
  fs.watch(extensionDir, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.js') || filename.endsWith('.html') || filename.endsWith('.json'))) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[Watcher] Extension file changed: ${filename}, sending reload command...`);
        try {
          broadcastToExtensions({ type: 'reload_extension' });
        } catch (e) {
          console.error('[Watcher] Error broadcasting reload to extension', e);
        }
      }, 500);
    }
  });

  console.log(`[Watcher] Watching extension directory for changes: ${extensionDir}`);
}

module.exports = watchExtension;
