/**
 * Diff Generator - unified diff 生成器
 * 
 * 生成和解析 unified diff 格式
 */
const fs = require('fs');
const path = require('path');

/**
 * 生成 unified diff 格式
 * @param {string} oldContent - 旧内容
 * @param {string} newContent - 新内容
 * @param {string} filePath - 文件路径
 * @returns {string} unified diff 文本
 */
function generateUnifiedDiff(oldContent, newContent, filePath) {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];
  
  const diffLines = [];
  const fileName = filePath || 'file';
  
  // 计算变更统计
  let additions = 0;
  let deletions = 0;
  
  // 简单的行比对算法
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  
  // 生成 diff
  let lineIndex = 0;
  const maxLines = Math.max(oldLines.length, newLines.length);
  
  // 使用简单的 LCS 算法
  const lcs = computeLCS(oldLines, newLines);
  
  let oldIdx = 0;
  let newIdx = 0;
  let oldStart = 1;
  let newStart = 1;
  
  diffLines.push(`--- a/${fileName}`);
  diffLines.push(`+++ b/${fileName}`);
  
  // 遍历 LCS 和剩余行
  let i = 0;
  let j = 0;
  let changes = [];
  
  // 简单实现：逐行比较
  for (let k = 0; k < Math.max(oldLines.length + 1, newLines.length + 1); k++) {
    const oldLine = oldLines[k];
    const newLine = newLines[k];
    
    if (oldLine === newLine) {
      // 相同，行作为上下文
      if (changes.length > 0) {
        // 输出变更块
        const changeBlock = formatHunk(changes, oldStart, newStart);
        diffLines.push(...changeBlock);
        changes = [];
      }
      newStart++;
      oldStart++;
    } else if (oldLine !== undefined && newLine === undefined) {
      // 删除
      changes.push({ type: 'remove', content: oldLine, oldLineNum: oldStart, newLineNum: null });
      oldStart++;
      deletions++;
    } else if (oldLine === undefined && newLine !== undefined) {
      // 新增
      changes.push({ type: 'add', content: newLine, oldLineNum: null, newLineNum: newStart });
      newStart++;
      additions++;
    } else {
      // 替换
      changes.push({ type: 'remove', content: oldLine, oldLineNum: oldStart, newLineNum: null });
      changes.push({ type: 'add', content: newLine, oldLineNum: null, newLineNum: newStart });
      oldStart++;
      newStart++;
      additions++;
      deletions++;
    }
  }
  
  // 输出最后的变更块
  if (changes.length > 0) {
    const changeBlock = formatHunk(changes, oldStart - changes.filter(c => c.type === 'remove').length, 
                                            newStart - changes.filter(c => c.type === 'add').length);
    diffLines.push(...changeBlock);
  }
  
  if (diffLines.length <= 2) {
    // 没有变更
    return '';
  }
  
  return diffLines.join('\n');
}

/**
 * 计算最长公共子序列
 */
function computeLCS(arr1, arr2) {
  const m = arr1.length;
  const n = arr2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // 回溯获取 LCS
  const lcs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return lcs;
}

/**
 * 格式化变更块 (hunk)
 */
function formatHunk(changes, oldStart, newStart) {
  const lines = [];
  const removals = changes.filter(c => c.type === 'remove');
  const additions = changes.filter(c => c.type === 'add');
  
  if (removals.length === 0 && additions.length === 0) {
    return [];
  }
  
  const oldCount = removals.length || 1;
  const newCount = additions.length || 1;
  
  lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
  
  for (const change of changes) {
    if (change.type === 'remove') {
      lines.push(`-${change.content}`);
    } else if (change.type === 'add') {
      lines.push(`+${change.content}`);
    }
  }
  
  return lines;
}

/**
 * 解析 unified diff 为结构化数据
 * @param {string} diffText - diff 文本
 * @returns {Object} 解析后的 diff 数据
 */
function parseUnifiedDiff(diffText) {
  if (!diffText || !diffText.trim()) {
    return { files: [], totalChanges: 0 };
  }

  const files = [];
  const lines = diffText.split('\n');
  
  let currentFile = null;
  let hunks = [];
  let currentHunk = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 检测文件头
    const oldFileMatch = line.match(/^--- a\/(.+)$/);
    const newFileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    
    if (oldFileMatch || newFileMatch) {
      // 保存之前的文件
      if (currentFile && hunks.length > 0) {
        files.push({
          path: currentFile,
          hunks: hunks
        });
      }
      currentFile = (oldFileMatch || newFileMatch)[1];
      hunks = [];
      continue;
    }
    
    // 检测 hunk 头
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch) {
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2]) || 1,
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4]) || 1,
        lines: []
      };
      hunks.push(currentHunk);
      continue;
    }
    
    // 检测变更行
    if (currentHunk && line.length > 0) {
      const type = line[0];
      if (type === '+' || type === '-' || type === ' ') {
        currentHunk.lines.push({
          type: type === '+' ? 'add' : (type === '-' ? 'remove' : 'context'),
          content: line.slice(1)
        });
      }
    }
  }
  
  // 保存最后一个文件
  if (currentFile && hunks.length > 0) {
    files.push({
      path: currentFile,
      hunks: hunks
    });
  }
  
  return {
    files,
    totalChanges: files.reduce((sum, f) => sum + f.hunks.length, 0)
  };
}

/**
 * 验证 diff 路径是否在 workspace 内
 * @param {Object} diffData - 解析后的 diff 数据
 * @param {string} workspacePath - workspace 路径
 * @returns {Object} 验证结果
 */
function validateDiffPaths(diffData, workspacePath) {
  if (!diffData || !diffData.files) {
    return { valid: false, invalidPaths: ['No files in diff'] };
  }

  const invalidPaths = [];
  const absWorkspace = path.resolve(workspacePath);

  for (const file of diffData.files) {
    const filePath = path.resolve(absWorkspace, file.path);
    
    // 检查是否在 workspace 外
    if (!filePath.startsWith(absWorkspace)) {
      invalidPaths.push(file.path);
    }
  }

  return {
    valid: invalidPaths.length === 0,
    invalidPaths
  };
}

/**
 * 计算 diff 统计
 * @param {string} diffText - diff 文本
 * @returns {Object} 统计信息
 */
function getDiffStats(diffText) {
  if (!diffText) {
    return { additions: 0, deletions: 0, files: 0 };
  }

  const lines = diffText.split('\n');
  let additions = 0;
  let deletions = 0;
  let files = 0;

  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      files++;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return { additions, deletions, files };
}

module.exports = {
  generateUnifiedDiff,
  parseUnifiedDiff,
  validateDiffPaths,
  getDiffStats
};