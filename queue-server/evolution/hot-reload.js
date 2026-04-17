const express = require('express');
const fs = require('fs');
const path = require('path');
const evolveExecutor = require('./evolve-executor');

const router = express.Router();
const handlerPath = path.join(__dirname, '..', 'custom-handler.js');

function getValidationService() {
  try {
    return require('../test-validator/validation-service').validationService;
  } catch (error) {
    console.warn('[EvolveRoute] Validation service unavailable:', error.message);
    return null;
  }
}

router.get('/validation-status', (req, res) => {
  const validationService = getValidationService();
  if (!validationService) {
    return res.status(503).json({ error: 'Validation service unavailable' });
  }

  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '5'), 10) || 5, 1), 20);

  return res.json({
    latest: validationService.getLatestEvolutionStatus(),
    history: validationService.getRecentEvolutionStatuses(limit)
  });
});

router.get('/', (req, res) => {
  try {
    const code = fs.readFileSync(handlerPath, 'utf8');
    res.json({ code });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read custom-handler.js' });
  }
});

router.post('/', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Code is required' });
  }

  try {
    const result = await evolveExecutor.evolveHandler({
      code,
      riskLevel: 'medium',
      evolutionId: `manual-evolve-${Date.now()}`
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

    console.log('[Evolve] custom-handler.js validated successfully. Restarting server...');
    setTimeout(() => {
      process.exit(0);
    }, 500);
  } catch (error) {
    console.error('[Evolve] Error saving code:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
