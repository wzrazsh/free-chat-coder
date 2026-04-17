const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'chat-state.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    deepseek_session_id TEXT,
    origin TEXT NOT NULL DEFAULT 'extension',
    mode_profile TEXT NOT NULL DEFAULT 'expert',
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT,
    last_message_hash TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_deepseek_session_id
    ON conversations(deepseek_session_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_origin_updated_at
    ON conversations(origin, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'assistant',
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, content_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
    ON messages(conversation_id, seq);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_hash
    ON messages(conversation_id, content_hash);

  CREATE TABLE IF NOT EXISTS browser_actions (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    conversation_id TEXT,
    action TEXT NOT NULL,
    params_json TEXT,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_browser_actions_conversation_created_at
    ON browser_actions(conversation_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    task_id TEXT,
    tool_name TEXT NOT NULL,
    params_json TEXT,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_created_at
    ON tool_calls(conversation_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS sync_states (
    conversation_id TEXT PRIMARY KEY,
    deepseek_session_id TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_hash TEXT,
    page_state_json TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

module.exports = {
  db,
  dbPath
};
