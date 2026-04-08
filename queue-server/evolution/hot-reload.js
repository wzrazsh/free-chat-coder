const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const handlerPath = path.join(__dirname, '..', 'custom-handler.js');

// Get current custom handler code
router.get('/', (req, res) => {
  try {
    const code = fs.readFileSync(handlerPath, 'utf8');
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read custom-handler.js' });
  }
});

// Update custom handler code and trigger restart
router.post('/', (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  try {
    // Write new code to file
    fs.writeFileSync(handlerPath, code, 'utf8');
    
    // Send response before exiting
    res.json({ message: 'Code updated. Server is restarting...' });
    
    // Trigger nodemon restart by exiting the process
    console.log('[Evolve] New code received. Restarting server...');
    setTimeout(() => {
      process.exit(0);
    }, 500);
    
  } catch (err) {
    console.error('[Evolve] Error saving code:', err);
    res.status(500).json({ error: 'Failed to write custom-handler.js' });
  }
});

module.exports = router;