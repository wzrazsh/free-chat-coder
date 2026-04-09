const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const handlerPath = path.join(__dirname, '..', 'custom-handler.js');
const backupPath = path.join(__dirname, '..', 'custom-handler.js.bak');

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

  // Syntax Check
  try {
    new vm.Script(code);
  } catch (syntaxError) {
    return res.status(400).json({ error: 'Syntax Error in provided code', details: syntaxError.message });
  }

  try {
    // Backup old code
    if (fs.existsSync(handlerPath)) {
      fs.copyFileSync(handlerPath, backupPath);
    }

    // Write new code to file
    fs.writeFileSync(handlerPath, code, 'utf8');
    
    // Test require (to catch runtime errors during module load)
    try {
      // Clear require cache
      delete require.cache[require.resolve(handlerPath)];
      require(handlerPath);
    } catch (loadError) {
      // Rollback
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, handlerPath);
      }
      return res.status(400).json({ error: 'Module Load Error, rolled back to previous version', details: loadError.message });
    }

    // Send response before exiting
    res.json({ message: 'Code updated and verified. Server is restarting...' });
    
    // Trigger restart by exiting the process
    console.log('[Evolve] New code received and verified. Restarting server...');
    setTimeout(() => {
      process.exit(0);
    }, 500);
    
  } catch (err) {
    console.error('[Evolve] Error saving code:', err);
    res.status(500).json({ error: 'Failed to write custom-handler.js' });
  }
});

module.exports = router;