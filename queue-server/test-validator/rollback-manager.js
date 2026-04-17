/**
 * 回滚管理器
 * 负责在测试验证失败时自动回滚代码变更
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(WORKSPACE_ROOT, 'queue-server', 'data', 'backups');

const ROLLBACK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

function sanitizeToken(value) {
  return String(value || 'backup').replace(/[^a-zA-Z0-9._-]/g, '_');
}

class RollbackRecord {
  constructor(evolutionId, backupPath, originalPath, metadataPath = null) {
    this.id = `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this.evolutionId = evolutionId;
    this.backupPath = backupPath;
    this.originalPath = originalPath;
    this.metadataPath = metadataPath;
    this.status = ROLLBACK_STATUS.PENDING;
    this.timestamp = new Date().toISOString();
    this.completedAt = null;
    this.error = null;
  }

  toJSON() {
    return {
      id: this.id,
      evolutionId: this.evolutionId,
      backupPath: this.backupPath,
      originalPath: this.originalPath,
      metadataPath: this.metadataPath,
      status: this.status,
      timestamp: this.timestamp,
      completedAt: this.completedAt,
      error: this.error
    };
  }
}

class RollbackManager {
  constructor() {
    this.records = new Map();
    this.backupDir = BACKUP_DIR;
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 创建备份
   * @param {string} filePath - 要备份的文件路径（绝对路径）
   * @param {string} evolutionId - 进化ID
   * @returns {RollbackRecord}
   */
  createBackup(filePath, evolutionId) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    this.ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(filePath);
    const backupFilename = `${sanitizeToken(evolutionId)}__${basename}.${timestamp}.bak`;
    const backupPath = path.join(this.backupDir, backupFilename);
    const metadataPath = `${backupPath}.meta.json`;

    fs.copyFileSync(filePath, backupPath);
    fs.writeFileSync(metadataPath, JSON.stringify({
      evolutionId,
      originalPath: filePath,
      backupPath,
      createdAt: new Date().toISOString()
    }, null, 2), 'utf8');

    const record = new RollbackRecord(evolutionId, backupPath, filePath, metadataPath);
    this.records.set(record.id, record);

    console.log(`[RollbackManager] Backup created: ${backupPath}`);
    return record;
  }

  /**
   * 执行回滚
   * @param {string} evolutionId - 进化ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async rollback(evolutionId, options = {}) {
    const dryRun = options.dryRun || false;

    console.log(`[RollbackManager] Starting rollback for evolution: ${evolutionId} (dryRun: ${dryRun})`);

    let relatedRecords = this._getRelatedRecords(evolutionId);
    if (relatedRecords.length === 0) {
      relatedRecords = this._loadRecordsFromDisk(evolutionId);
    }

    if (relatedRecords.length === 0) {
      return {
        success: false,
        error: `No backup found for evolution: ${evolutionId}`
      };
    }

    const results = [];
    for (const record of relatedRecords) {
      try {
        if (dryRun) {
          console.log(`[RollbackManager] DRY RUN: Would restore ${record.backupPath} -> ${record.originalPath}`);
          record.status = ROLLBACK_STATUS.PENDING;
        } else {
          record.status = ROLLBACK_STATUS.IN_PROGRESS;
          await this.restoreFile(record);
          record.status = ROLLBACK_STATUS.COMPLETED;
          record.completedAt = new Date().toISOString();
          console.log(`[RollbackManager] Rollback completed: ${record.originalPath}`);
        }

        results.push({ record: record.toJSON(), success: true });
      } catch (error) {
        record.status = ROLLBACK_STATUS.FAILED;
        record.error = error.message;
        console.error(`[RollbackManager] Rollback failed for ${record.originalPath}:`, error.message);
        results.push({ record: record.toJSON(), success: false, error: error.message });
      }
    }

    return {
      success: results.every((result) => result.success),
      evolutionId,
      dryRun,
      results,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 成功后清理备份
   * @param {string} evolutionId
   * @returns {Object}
   */
  discard(evolutionId) {
    const relatedRecords = this._getRelatedRecords(evolutionId).concat(this._loadRecordsFromDisk(evolutionId));
    const seen = new Set();

    for (const record of relatedRecords) {
      if (seen.has(record.backupPath)) {
        continue;
      }

      seen.add(record.backupPath);
      if (fs.existsSync(record.backupPath)) {
        fs.unlinkSync(record.backupPath);
      }
      if (record.metadataPath && fs.existsSync(record.metadataPath)) {
        fs.unlinkSync(record.metadataPath);
      }
    }

    for (const [recordId, record] of this.records.entries()) {
      if (record.evolutionId === evolutionId) {
        this.records.delete(recordId);
      }
    }

    return {
      success: true,
      evolutionId,
      removed: seen.size
    };
  }

  async restoreFile(record) {
    if (!fs.existsSync(record.backupPath)) {
      throw new Error(`Backup file not found: ${record.backupPath}`);
    }

    const targetDir = path.dirname(record.originalPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(record.backupPath, record.originalPath);
  }

  getRecords(evolutionId) {
    return Array.from(this.records.values())
      .filter((record) => record.evolutionId === evolutionId)
      .map((record) => record.toJSON());
  }

  getAllRecords() {
    return Array.from(this.records.values()).map((record) => record.toJSON());
  }

  clearCompleted() {
    for (const [id, record] of this.records.entries()) {
      if (record.status === ROLLBACK_STATUS.COMPLETED) {
        this.records.delete(id);
      }
    }
  }

  _getRelatedRecords(evolutionId) {
    return Array.from(this.records.values())
      .filter((record) => (
        record.evolutionId === evolutionId &&
        record.status !== ROLLBACK_STATUS.COMPLETED
      ));
  }

  _loadRecordsFromDisk(evolutionId) {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const records = [];
    const files = fs.readdirSync(this.backupDir);
    for (const filename of files) {
      if (!filename.endsWith('.meta.json')) {
        continue;
      }

      const metadataPath = path.join(this.backupDir, filename);
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (metadata.evolutionId !== evolutionId || !metadata.backupPath || !metadata.originalPath) {
          continue;
        }

        const record = new RollbackRecord(
          metadata.evolutionId,
          metadata.backupPath,
          metadata.originalPath,
          metadataPath
        );
        this.records.set(record.id, record);
        records.push(record);
      } catch (error) {
        console.warn(`[RollbackManager] Failed to parse metadata ${metadataPath}: ${error.message}`);
      }
    }

    return records;
  }
}

const rollbackManager = new RollbackManager();

module.exports = {
  rollbackManager,
  RollbackManager,
  RollbackRecord,
  ROLLBACK_STATUS
};
