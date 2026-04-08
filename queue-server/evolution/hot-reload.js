// /workspace/queue-server/evolution/hot-reload.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CUSTOM_HANDLER_PATH = path.join(__dirname, '..', 'custom-handler.js');

// Save new code and trigger reload
router.post('/', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Code string is required' });
  }

  try {
    fs.writeFileSync(CUSTOM_HANDLER_PATH, code, 'utf8');
    console.log('[Evolve] New custom handler saved.');
    
    // Return response before exiting to avoid request timeout
    res.json({ message: 'Evolution applied successfully. Server restarting...' });

    // Give express a moment to send the response before exit
    setTimeout(() => {
      console.log('[Evolve] Triggering nodemon restart...');
      process.exit(0);
    }, 500);

  } catch (err) {
    console.error('[Evolve] Failed to write new code:', err);
    res.status(500).json({ error: 'Failed to write code' });
  }
});

module.exports = router;
