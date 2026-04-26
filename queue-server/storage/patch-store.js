/**
 * Patch Store - Patch 数据持久化模块
 * 
 * 提供 patch 提案的创建、查询、更新、验证和应用功能
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./sqlite');
const { generateUnifiedDiff, validateDiffPaths } = require('../actions/diff-generator');

const WORKSPACE_PATH = require('../../shared/config').workspace.path;

/**
 * 生成 patch ID
 */
function generatePatchId() {
  return `patch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成 event ID
 */
function generateEventId() {
  return `pe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建 patch 提案
 * @param {Object} patchData - patch 数据
 * @returns {Object} 创建的 patch
 */
function createPatch(patchData) {
  const id = generatePatchId();
  const now = new Date().toISOString();
  
  const patch = {
    id,
    task_id: patchData.taskId || null,
    conversation_id: patchData.conversationId || null,
    status: 'draft',
    summary: patchData.summary || '',
    changes_json: JSON.stringify(patchData.changes || []),
    risk_level: patchData.riskLevel || 'medium',
    source: patchData.source || 'deepseek',
    created_at: now,
    updated_at: now
  };

  const stmt = db.prepare(`
    INSERT INTO patches (id, task_id, conversation_id, status, summary, changes_json, risk_level, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    patch.id,
    patch.task_id,
    patch.conversation_id,
    patch.status,
    patch.summary,
    patch.changes_json,
    patch.risk_level,
    patch.source,
    patch.created_at,
    patch.updated_at
  );

  // 记录创建事件
  recordPatchEvent(id, 'created', 'system', `Patch created from ${patch.source}`);

  return getPatch(id);
}

/**
 * 获取 patch 列表
 * @param {Object} filters - 过滤条件
 * @returns {Array} patch 数组
 */
function getPatches(filters = {}) {
  let sql = 'SELECT * FROM patches WHERE 1=1';
  const params = [];

  if (filters.taskId) {
    sql += ' AND task_id = ?';
    params.push(filters.taskId);
  }

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.conversationId) {
    sql += ' AND conversation_id = ?';
    params.push(filters.conversationId);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += ' OFFSET ?';
    params.push(filters.offset);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  return rows.map(row => deserializePatch(row));
}

/**
 * 获取单个 patch
 * @param {string} patchId - patch ID
 * @returns {Object|null} patch 对象
 */
function getPatch(patchId) {
  const stmt = db.prepare('SELECT * FROM patches WHERE id = ?');
  const row = stmt.get(patchId);
  
  if (!row) return null;
  
  return deserializePatch(row);
}

/**
 * 反序列化 patch 行数据
 */
function deserializePatch(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    status: row.status,
    summary: row.summary,
    changes: JSON.parse(row.changes_json || '[]'),
    riskLevel: row.risk_level,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * 更新 patch 状态
 * @param {string} patchId - patch ID
 * @param {string} status - 新状态
 * @param {string} details - 事件详情
 * @returns {Object|null} 更新后的 patch
 */
function updatePatchStatus(patchId, status, details = null) {
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    UPDATE patches SET status = ?, updated_at = ? WHERE id = ?
  `);
  
  const result = stmt.run(status, now, patchId);
  
  if (result.changes === 0) {
    return null;
  }

  // 记录状态变更事件
  recordPatchEvent(patchId, status, 'user', details);

  return getPatch(patchId);
}

/**
 * 记录 patch 事件
 */
function recordPatchEvent(patchId, event, actor, details = null) {
  const id = generateEventId();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO patch_events (id, patch_id, event, actor, timestamp, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, patchId, event, actor, now, details);
}

/**
 * 验证 patch 安全性
 * @param {string} patchId - patch ID
 * @returns {Object} 验证结果
 */
function validatePatch(patchId) {
  const patch = getPatch(patchId);
  
  if (!patch) {
    return { valid: false, warnings: ['Patch not found'] };
  }

  const warnings = [];
  const changes = patch.changes || [];
  
  // 检查路径安全性
  for (const change of changes) {
    const changePath = change.path || '';
    
    // 检查是否在 workspace 外
    if (!changePath.startsWith('/') && !changePath.startsWith('\\')) {
      warnings.push(`Path "${changePath}" is not absolute`);
    }
    
    // 检查是否包含危险操作（如删除系统文件）
    if (change.changeType === 'delete') {
      if (changePath.includes('node_modules') || changePath.includes('.git')) {
        warnings.push(`Refusing to delete files in "${changePath}"`);
      }
    }
  }

  // 检查危险操作
  if (patch.riskLevel === 'high') {
    warnings.push('High risk: This patch may modify critical files');
  }

  const valid = warnings.length === 0;

  if (valid) {
    recordPatchEvent(patchId, 'validated', 'system', 'Patch validated successfully');
  } else {
    recordPatchEvent(patchId, 'validated', 'system', `Validation warnings: ${warnings.join(', ')}`);
  }

  return { valid, warnings };
}

/**
 * 应用 patch 到文件系统
 * @param {string} patchId - patch ID
 * @returns {Object} 应用结果
 */
function applyPatch(patchId) {
  const patch = getPatch(patchId);
  
  if (!patch) {
    return { success: false, applied: [], failed: ['Patch not found'] };
  }

  if (patch.status !== 'approved') {
    return { success: false, applied: [], failed: ['Patch must be approved before applying'] };
  }

  const applied = [];
  const failed = [];
  const changes = patch.changes || [];
  const workspacePath = WORKSPACE_PATH;

  for (const change of changes) {
    const filePath = path.join(workspacePath, change.path);
    
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (change.changeType === 'delete') {
        // 删除文件
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          applied.push(change.path);
        }
      } else {
        // 写入文件
        fs.writeFileSync(filePath, change.newContent || '', 'utf-8');
        applied.push(change.path);
      }
    } catch (error) {
      failed.push(`${change.path}: ${error.message}`);
    }
  }

  // 更新状态
  const success = failed.length === 0;
  updatePatchStatus(
    patchId,
    success ? 'applied' : 'failed',
    success ? `Applied ${applied.length} files` : `Failed: ${failed.join(', ')}`
  );

  return { success, applied, failed };
}

/**
 * 获取 patch 的 diff 预览
 * @param {string} patchId - patch ID
 * @returns {Object} diff 预览数据
 */
function getPatchDiff(patchId) {
  const patch = getPatch(patchId);
  
  if (!patch) {
    return null;
  }

  const diffs = [];
  const changes = patch.changes || [];
  const workspacePath = WORKSPACE_PATH;

  for (const change of changes) {
    let oldContent = '';
    
    // 尝试读取旧内容
    const filePath = path.join(workspacePath, change.path);
    if (fs.existsSync(filePath) && change.changeType !== 'create') {
      try {
        oldContent = fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        // 忽略读取错误
      }
    }

    const newContent = change.newContent || '';
    const diffText = generateUnifiedDiff(oldContent, newContent, change.path);
    
    // 计算统计
    const lines = diffText.split('\n');
    let additions = 0;
    let deletions = 0;
    
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    diffs.push({
      path: change.path,
      changeType: change.changeType || 'modify',
      diff: diffText,
      additions,
      deletions
    });
  }

  return {
    patchId: patch.id,
    summary: patch.summary,
    riskLevel: patch.riskLevel,
    status: patch.status,
    files: diffs,
    totalChanges: diffs.length
  };
}

/**
 * 获取 patch 事件历史
 * @param {string} patchId - patch ID
 * @returns {Array} 事件数组
 */
function getPatchEvents(patchId) {
  const stmt = db.prepare('SELECT * FROM patch_events WHERE patch_id = ? ORDER BY timestamp ASC');
  return stmt.all(patchId);
}

module.exports = {
  createPatch,
  getPatches,
  getPatch,
  updatePatchStatus,
  validatePatch,
  applyPatch,
  getPatchDiff,
  getPatchEvents
};