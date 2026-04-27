const crypto = require('crypto');
const { db } = require('../storage/sqlite');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function fromJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeHash(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function normalizeMessage(message) {
  const role = message.role || 'assistant';
  const content = typeof message.content === 'string' ? message.content : '';
  const metadata = message.metadata || {
    index: message.index,
    codeBlocks: message.codeBlocks,
    thinkContent: message.thinkContent,
    messageType: message.messageType,
    isComplete: message.isComplete,
    sessionId: message.sessionId
  };
  const contentHash = message.contentHash || normalizeHash(`${role}\n${content}\n${JSON.stringify(metadata || {})}`);

  return {
    role,
    content,
    source: message.source || role,
    contentHash,
    metadata
  };
}

function mapConversation(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    deepseekSessionId: row.deepseek_session_id,
    origin: row.origin,
    modeProfile: row.mode_profile,
    title: row.title,
    status: row.status,
    metadata: fromJson(row.metadata_json, {}),
    lastMessageHash: row.last_message_hash,
    lastSyncedAt: row.last_synced_at,
    messageCount: row.message_count ?? 0,
    lastMessagePreview: row.last_message_preview || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    contentHash: row.content_hash,
    source: row.source,
    metadata: fromJson(row.metadata_json, {}),
    createdAt: row.created_at,
    syncedAt: row.synced_at
  };
}

const getConversationStmt = db.prepare(`
  SELECT c.*, 
         COALESCE(m.message_count, 0) AS message_count,
         lm.content AS last_message_preview
  FROM conversations c
  LEFT JOIN (
    SELECT conversation_id, COUNT(*) AS message_count, MAX(seq) AS max_seq
    FROM messages
    GROUP BY conversation_id
  ) m ON m.conversation_id = c.id
  LEFT JOIN messages lm ON lm.conversation_id = c.id AND lm.seq = m.max_seq
  WHERE c.id = ?
`);

const getConversationBySessionStmt = db.prepare(`
  SELECT c.*, 
         COALESCE(m.message_count, 0) AS message_count,
         lm.content AS last_message_preview
  FROM conversations c
  LEFT JOIN (
    SELECT conversation_id, COUNT(*) AS message_count, MAX(seq) AS max_seq
    FROM messages
    GROUP BY conversation_id
  ) m ON m.conversation_id = c.id
  LEFT JOIN messages lm ON lm.conversation_id = c.id AND lm.seq = m.max_seq
  WHERE c.deepseek_session_id = ?
`);

const listConversationsBase = `
  SELECT c.*, 
         COALESCE(m.message_count, 0) AS message_count,
         lm.content AS last_message_preview
  FROM conversations c
  LEFT JOIN (
    SELECT conversation_id, COUNT(*) AS message_count, MAX(seq) AS max_seq
    FROM messages
    GROUP BY conversation_id
  ) m ON m.conversation_id = c.id
  LEFT JOIN messages lm ON lm.conversation_id = c.id AND lm.seq = m.max_seq
`;

function listConversations({ origin, limit = 50 } = {}) {
  const query = origin
    ? `${listConversationsBase} WHERE c.origin = ? ORDER BY c.updated_at DESC LIMIT ?`
    : `${listConversationsBase} ORDER BY c.updated_at DESC LIMIT ?`;
  const stmt = db.prepare(query);
  const rows = origin ? stmt.all(origin, limit) : stmt.all(limit);
  return rows.map(mapConversation);
}

function getConversation(id) {
  return mapConversation(getConversationStmt.get(id));
}

function getConversationBySessionId(deepseekSessionId) {
  if (!deepseekSessionId) {
    return null;
  }

  return mapConversation(getConversationBySessionStmt.get(deepseekSessionId));
}

function getConversationMessages(conversationId) {
  const rows = db.prepare(`
    SELECT *
    FROM messages
    WHERE conversation_id = ?
    ORDER BY seq ASC
  `).all(conversationId);

  return rows.map(mapMessage);
}

function createConversation({
  deepseekSessionId = null,
  origin = 'extension',
  modeProfile = 'expert',
  title = null,
  status = 'active',
  metadata = {}
} = {}) {
  if (deepseekSessionId) {
    const existing = getConversationBySessionId(deepseekSessionId);
    if (existing) {
      return existing;
    }
  }

  const timestamp = nowIso();
  const id = createId('conv');

  db.prepare(`
    INSERT INTO conversations (
      id,
      deepseek_session_id,
      origin,
      mode_profile,
      title,
      status,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    deepseekSessionId,
    origin,
    modeProfile,
    title,
    status,
    toJson(metadata),
    timestamp,
    timestamp
  );

  db.prepare(`
    INSERT INTO sync_states (
      conversation_id,
      deepseek_session_id,
      message_count,
      updated_at
    ) VALUES (?, ?, 0, ?)
  `).run(id, deepseekSessionId, timestamp);

  return getConversation(id);
}

function syncConversation(conversationId, payload = {}) {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    throw new Error(`ConversationNotFound: ${conversationId}`);
  }

  const timestamp = nowIso();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const normalizedMessages = messages.map(normalizeMessage).filter((message) => message.content);

  const transaction = db.transaction(() => {
    const currentMaxSeqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM messages WHERE conversation_id = ?').get(conversationId);
    let nextSeq = currentMaxSeqRow.maxSeq + 1;
    let insertedCount = 0;
    let lastInsertedHash = conversation.lastMessageHash;

    const insertMessageStmt = db.prepare(`
      INSERT OR IGNORE INTO messages (
        id,
        conversation_id,
        seq,
        role,
        content,
        content_hash,
        source,
        metadata_json,
        created_at,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const message of normalizedMessages) {
      const messageId = createId('msg');
      const result = insertMessageStmt.run(
        messageId,
        conversationId,
        nextSeq,
        message.role,
        message.content,
        message.contentHash,
        message.source,
        toJson(message.metadata),
        timestamp,
        timestamp
      );

      if (result.changes > 0) {
        insertedCount += 1;
        lastInsertedHash = message.contentHash;
        nextSeq += 1;
      }
    }

    const totalMessages = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(conversationId).count;
    const title = payload.title || conversation.title;
    const modeProfile = payload.modeProfile || conversation.modeProfile;
    const deepseekSessionId = payload.deepseekSessionId || conversation.deepseekSessionId;
    const mergedMetadata = {
      ...(conversation.metadata || {}),
      ...(payload.metadata || {}),
      pageState: payload.pageState || (conversation.metadata || {}).pageState || null,
      modelState: payload.modelState || (conversation.metadata || {}).modelState || null,
      sessionList: payload.sessionList || (conversation.metadata || {}).sessionList || null
    };

    db.prepare(`
      UPDATE conversations
      SET deepseek_session_id = ?,
          mode_profile = ?,
          title = ?,
          status = ?,
          metadata_json = ?,
          last_message_hash = ?,
          last_synced_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      deepseekSessionId,
      modeProfile,
      title,
      payload.status || conversation.status,
      toJson(mergedMetadata),
      lastInsertedHash,
      timestamp,
      timestamp,
      conversationId
    );

    db.prepare(`
      INSERT INTO sync_states (
        conversation_id,
        deepseek_session_id,
        message_count,
        last_message_hash,
        page_state_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        deepseek_session_id = excluded.deepseek_session_id,
        message_count = excluded.message_count,
        last_message_hash = excluded.last_message_hash,
        page_state_json = excluded.page_state_json,
        updated_at = excluded.updated_at
    `).run(
      conversationId,
      deepseekSessionId,
      totalMessages,
      lastInsertedHash,
      toJson(payload.pageState || null),
      timestamp
    );

    return {
      insertedCount,
      totalMessages,
      lastMessageHash: lastInsertedHash
    };
  });

  const syncResult = transaction();
  return {
    conversation: getConversation(conversationId),
    ...syncResult,
    messages: getConversationMessages(conversationId)
  };
}

function recordBrowserAction({ requestId, conversationId = null, action, params = {}, status = 'pending' }) {
  const timestamp = nowIso();
  const id = createId('bact');

  db.prepare(`
    INSERT INTO browser_actions (
      id,
      request_id,
      conversation_id,
      action,
      params_json,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, requestId, conversationId, action, toJson(params), status, timestamp, timestamp);

  return { id, requestId, conversationId, action, status, createdAt: timestamp, updatedAt: timestamp };
}

function completeBrowserAction({ requestId, status = 'completed', result = null, error = null }) {
  const timestamp = nowIso();
  db.prepare(`
    UPDATE browser_actions
    SET status = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
    WHERE request_id = ?
  `).run(status, toJson(result), error, timestamp, requestId);
}

function deleteConversation(id) {
  const conversation = getConversation(id);
  if (!conversation) {
    return null;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  });

  transaction();
  return conversation;
}

module.exports = {
  createConversation,
  getConversation,
  getConversationBySessionId,
  getConversationMessages,
  listConversations,
  syncConversation,
  recordBrowserAction,
  completeBrowserAction,
  deleteConversation
};
