const express = require('express');
const router = express.Router();
const conversationStore = require('../conversations/store');
const wsHandler = require('../websocket/handler');

router.get('/', (req, res) => {
  const origin = req.query.origin || undefined;
  const limit = Number(req.query.limit) || 50;
  const conversations = conversationStore.listConversations({ origin, limit });
  res.json({ conversations });
});

router.post('/', (req, res) => {
  const conversation = conversationStore.createConversation(req.body || {});

  wsHandler.broadcastToWeb({
    type: 'conversation_created',
    conversation
  });

  res.status(201).json({ conversation });
});

router.get('/:id', (req, res) => {
  const conversation = conversationStore.getConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  res.json({ conversation });
});

router.get('/:id/messages', (req, res) => {
  const conversation = conversationStore.getConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = conversationStore.getConversationMessages(req.params.id);
  res.json({ conversation, messages });
});

router.post('/:id/sync', (req, res) => {
  try {
    const syncResult = conversationStore.syncConversation(req.params.id, req.body || {});

    wsHandler.broadcastToWeb({
      type: 'conversation_updated',
      conversation: syncResult.conversation
    });
    wsHandler.broadcastToWeb({
      type: 'conversation_messages_updated',
      conversationId: req.params.id,
      insertedCount: syncResult.insertedCount,
      totalMessages: syncResult.totalMessages
    });

    res.json(syncResult);
  } catch (error) {
    if (error.message && error.message.startsWith('ConversationNotFound')) {
      return res.status(404).json({ error: error.message });
    }

    console.error('[ConversationsRoute] Sync failed:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
  }
});

router.delete('/:id', (req, res) => {
  const conversation = conversationStore.deleteConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  wsHandler.broadcastToWeb({
    type: 'conversation_deleted',
    conversationId: req.params.id
  });

  res.json({ success: true });
});

module.exports = router;
