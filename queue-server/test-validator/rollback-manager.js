/**
 * 回滚管理器
 * 负责在测试验证失败时自动回滚代码变更
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
const BACKUP_DIR = path.join(WORKSPACE_ROOT, 'queue-server', 'data', 'backups');

/**
 * 回滚状态
 */
const ROLLBACK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * 回滚记录类
 */
class RollbackRecord {
  constructor(evolutionId, backupPath, originalPath) {
    this.id = `rollback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.evolutionId = evolutionId;
    this.backupPath = backupPath;
    this.originalPath = originalPath;
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
      status: this.status,
      timestamp: this.timestamp,
      completedAt: this.completedAt,
      error: this.error
    };
  }
}

/**
 * 回滚管理器类
 */
class RollbackManager {
  constructor() {
    this.records = new Map();
    this.backupDir = BACKUP_DIR;
    this.ensureBackupDir();
  }

  /**
   * 确保备份目录存在
   */
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(filePath);
    const backupFilename = `${basename}.${timestamp}.bak`;
    const backupPath = path.join(this.backupDir, backupFilename);

    // 复制文件到备份目录
    fs.copyFileSync(filePath, backupPath);

    const record = new RollbackRecord(evolutionId, backupPath, filePath);
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
    const force = options.force || false;

    console.log(`[RollbackManager] Starting rollback for evolution: ${evolutionId} (dryRun: ${dryRun})`);

    // 查找相关的备份记录
    const relatedRecords = Array.from(this.records.values())
      .filter(r => r.evolutionId === evolutionId && r.status !== ROLLBACK_STATUS.COMPLETED);

    if (relatedRecords.length === 0) {
      // 尝试查找备份文件
      const backupFiles = this.findBackupFiles(evolutionId);
      if (backupFiles.length === 0) {
        return {
          success: false,
          error: `No backup found for evolution: ${evolutionId}`
        };
      }

      // 从备份文件恢复记录
      for (const backupFile of backupFiles) {
        const originalPath = this.getOriginalPathFromBackup(backupFile);
        if (originalPath) {
          const record = new RollbackRecord(evolutionId, backupFile, originalPath);
          this.records.set(record.id, record);
          relatedRecords.push(record);
        }
      }
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

    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      evolutionId,
      dryRun,
      results,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 恢复文件
   * @param {RollbackRecord} record
   */
  async restoreFile(record) {
    if (!fs.existsSync(record.backupPath)) {
      throw new Error(`Backup file not found: ${record.backupPath}`);
    }

    // 确保目标目录存在
    const targetDir = path.dirname(record.originalPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 覆盖原文件
    fs.copyFileSync(record.backupPath, record.originalPath);

    // 删除备份文件（可选）
    // fs.unlinkSync(record.backupPath);
  }

  /**
   * 查找备份文件
   * @param {string} evolutionId
   * @returns {Array<string>}
   */
  findBackupFiles(evolutionId) {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    return files
      .filter(f => f.endsWith('.bak'))
      .map(f => path.join(this.backupDir, f));
  }

  /**
   * 从备份文件名推断原文件路径
   * 备份文件命名格式：{originalname}.{ISO-timestamp-with-dashes}.bak
   * 例如：content.js.2026-04-16T12-00-00-000Z.bak
   * ISO 时间戳特征：以 \d{4}-\d{2}-\d{2}T 开头
   * @param {string} backupPath
   * @returns {string|null}
   */
  getOriginalPathFromBackup(backupPath) {
    // 去掉 .bak 后缀
    const withoutBak = path.basename(backupPath, '.bak');

    // 匹配 ISO 时间戳（已被替换为 - 的冒号和点），格式如 2026-04-16T12-00-00-000Z
    const isoTimestampPattern = /\.\d{4}-\d{2}-\d{2}T[\d\-]+Z$/;
    const originalName = withoutBak.replace(isoTimestampPattern, '');

    if (!originalName || originalName === withoutBak) {
      // 时间戳匹配失败，尝试降级：去掉最后一个 .xxx 后缀（旧格式 .bak1 / .bak2 …）
      return null;
    }

    // 在 chromevideo 和 queue-server 两个目录中查找同名文件
    const searchDirs = [
      path.join(WORKSPACE_ROOT, 'chromevideo'),
      path.join(WORKSPACE_ROOT, 'queue-server')
    ];

    for (const dir of searchDirs) {
      const candidate = path.join(dir, originalName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // 找不到时返回 queue-server 下的默认路径（用于 custom-handler.js 等已知文件）
    const knownFiles = {
      'custom-handler.js': path.join(WORKSPACE_ROOT, 'queue-server', 'custom-handler.js')
    };
    return knownFiles[originalName] || null;
  }

  /**
   * 获取回滚记录
   * @param {string} evolutionId
   * @returns {Array}
   */
  getRecords(evolutionId) {
    return Array.from(this.records.values())
      .filter(r => r.evolutionId === evolutionId)
      .map(r => r.toJSON());
  }

  /**
   * 获取所有记录
   * @returns {Array}
   */
  getAllRecords() {
    return Array.from(this.records.values()).map(r => r.toJSON());
  }

  /**
   * 清除完成的记录
   */
  clearCompleted() {
    for (const [id, record] of this.records) {
      if (record.status === ROLLBACK_STATUS.COMPLETED) {
        this.records.delete(id);
      }
    }
  }
}

// 导出单例实例
const rollbackManager = new RollbackManager();

module.exports = {
  rollbackManager,
  RollbackManager,
  RollbackRecord,
  ROLLBACK_STATUS
};
