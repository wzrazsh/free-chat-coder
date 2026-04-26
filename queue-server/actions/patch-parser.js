/**
 * Patch Parser - 从 DeepSeek 回复中解析 patch 提案
 * 
 * 从 DeepSeek 的回复中检测和提取文件修改建议
 */

/**
 * 检测回复是否包含 patch 提案
 * @param {string} replyText - DeepSeek 回复文本
 * @returns {boolean} 是否包含 patch
 */
function hasPatchProposal(replyText) {
  if (!replyText) return false;

  // 检测多种格式的 patch 标记
  const patterns = [
    /<PatchBlock>/i,
    /```(patch|diff|diff UNIFIED)/i,
    /\[PATCH:/i,
    /\[DIFF:/i,
    /<FilePatch>/i,
    /```file-[^\n]+\n/i  // ```file-app.js 等格式
  ];

  for (const pattern of patterns) {
    if (pattern.test(replyText)) {
      return true;
    }
  }

  return false;
}

/**
 * 从 DeepSeek 回复中解析 patch 提案
 * @param {string} replyText - DeepSeek 回复文本
 * @returns {Object|null} patch 提案数据
 */
function parsePatchProposal(replyText) {
  if (!replyText) return null;

  const changes = [];
  let summary = '';

  // 模式 1: <PatchBlock>...</PatchBlock>
  const blockMatch = replyText.match(/<PatchBlock>([\s\S]*?)<\/PatchBlock>/i);
  if (blockMatch) {
    return parseBlockContent(blockMatch[1]);
  }

  // 模式 2: ```diff 或 ```patch 代码块
  const diffBlockRegex = /```(?:diff|patch UNIFIED|diff UNIFIED)\n([\s\S]*?)```/g;
  let match;
  while ((match = diffBlockRegex.exec(replyText)) !== null) {
    const parsed = parseDiffBlock(match[1]);
    if (parsed) {
      changes.push(...parsed);
    }
  }

  // 模式 3: [PATCH:{...}] 行内格式
  const inlineRegex = /\[PATCH:(\{[\s\S]*?\})\]/g;
  while ((match = inlineRegex.exec(replyText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.path && parsed.newContent) {
        changes.push({
          path: parsed.path,
          oldContent: parsed.oldContent || '',
          newContent: parsed.newContent,
          changeType: parsed.changeType || 'modify'
        });
      }
      if (parsed.summary) {
        summary = parsed.summary;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 模式 4: ```file-path\ncontent``` 格式
  const fileBlockRegex = /```file-([^\n]+)\n([\s\S]*?)```/g;
  while ((match = fileBlockRegex.exec(replyText)) !== null) {
    changes.push({
      path: match[1].trim(),
      oldContent: '',
      newContent: match[2],
      changeType: 'create'
    });
  }

  // 模式 5: 检测行内文件修改建议 "File: path\nContent:..."
  const fileContentRegex = /File:\s*(.+?)\n(?:Old:[\s\S]*?\n)?New:(```[\s\S]*?```|.+?)(?=\n\n|$)/g;
  while ((match = fileContentRegex.exec(replyText)) !== null) {
    const filePath = match[1].trim();
    let newContent = match[2].trim();
    
    // 移除 ``` 包装
    if (newContent.startsWith('```') && newContent.endsWith('```')) {
      newContent = newContent.slice(3, -3).trim();
    }
    
    if (filePath && newContent) {
      changes.push({
        path: filePath,
        oldContent: '',
        newContent: newContent,
        changeType: 'modify'
      });
    }
  }

  if (changes.length === 0) {
    return null;
  }

  // 生成摘要
  if (!summary) {
    summary = changes.map(c => c.path).join(', ');
    if (summary.length > 200) {
      summary = summary.slice(0, 197) + '...';
    }
  }

  return {
    summary,
    changes,
    riskLevel: determineRiskLevel(changes),
    source: 'deepseek'
  };
}

/**
 * 解析 PatchBlock 内容
 */
function parseBlockContent(content) {
  const changes = [];
  let summary = '';

  // 尝试解析 JSON
  try {
    const data = JSON.parse(content);
    if (data.summary) {
      summary = data.summary;
    }
    if (Array.isArray(data.changes)) {
      for (const change of data.changes) {
        changes.push({
          path: change.path || change.file,
          oldContent: change.oldContent || change.old || '',
          newContent: change.newContent || change.content || '',
          changeType: change.changeType || 'modify'
        });
      }
    }
  } catch (e) {
    // 不是 JSON，尝试其他格式
  }

  if (changes.length === 0) {
    // 尝试解析 diff 格式
    const diffChanges = parseDiffContent(content);
    changes.push(...diffChanges);
  }

  if (changes.length === 0) {
    return null;
  }

  return {
    summary,
    changes,
    riskLevel: determineRiskLevel(changes),
    source: 'deepseek'
  };
}

/**
 * 解析 diff 内容
 */
function parseDiffContent(diffText) {
  const changes = [];
  const lines = diffText.split('\n');
  
  let currentPath = '';
  let mode = null;
  let oldLines = [];
  let newLines = [];

  for (const line of lines) {
    // 检测文件头
    const oldFileMatch = line.match(/^--- a\/(.+)$/);
    const newFileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    
    if (oldFileMatch || newFileMatch) {
      // 保存之前的文件
      if (currentPath && (oldLines.length > 0 || newLines.length > 0)) {
        // 这个简单的实现只保存新内容
      }
      currentPath = (oldFileMatch || newFileMatch)[1];
      oldLines = [];
      newLines = [];
      mode = null;
      continue;
    }

    // 检测 hunk 头
    if (line.startsWith('@@')) {
      mode = 'hunk';
      continue;
    }

    // 收集变更行
    if (mode === 'hunk') {
      if (line.startsWith('-')) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.slice(1));
      } else if (line.startsWith(' ') || line.length === 0) {
        oldLines.push(line);
        newLines.push(line);
      }
    }
  }

  // 保存最后一个文件
  if (currentPath && newLines.length > 0) {
    changes.push({
      path: currentPath,
      oldContent: oldLines.join('\n'),
      newContent: newLines.join('\n'),
      changeType: 'modify'
    });
  }

  return changes;
}

/**
 * 解析代码块内容为 changes
 */
function parseBlockContentLegacy(content) {
  const changes = [];
  const lines = content.split('\n');
  
  let currentPath = '';
  let currentContent = [];
  let inFile = false;

  for (const line of lines) {
    // 检测文件路径标记
    const pathMatch = line.match(/^(?:File|Path|Filename):\s*(.+)$/i);
    if (pathMatch) {
      // 保存之前的文件
      if (currentPath && currentContent.length > 0) {
        changes.push({
          path: currentPath,
          oldContent: '',
          newContent: currentContent.join('\n'),
          changeType: currentPath ? 'modify' : 'create'
        });
      }
      currentPath = pathMatch[1].trim();
      currentContent = [];
      inFile = true;
      continue;
    }

    if (inFile) {
      currentContent.push(line);
    }
  }

  // 保存最后一个文件
  if (currentPath && currentContent.length > 0) {
    changes.push({
      path: currentPath,
      oldContent: '',
      newContent: currentContent.join('\n'),
      changeType: 'modify'
    });
  }

  return changes;
}

/**
 * 解析 diff 代码块
 */
function parseDiffBlock(diffContent) {
  const changes = [];
  const lines = diffContent.split('\n');
  
  let currentPath = '';
  let oldContent = [];
  let newContent = [];

  for (const line of lines) {
    // 检测文件头
    const oldMatch = line.match(/^--- a\/(.+)$/);
    const newMatch = line.match(/^\+\+\+ b\/(.+)$/);
    
    if (oldMatch) {
      currentPath = oldMatch[1];
      continue;
    }
    if (newMatch) {
      currentPath = newMatch[1];
      continue;
    }

    // 收集变更
    if (line.startsWith('-')) {
      oldContent.push(line.slice(1));
    } else if (line.startsWith('+')) {
      newContent.push(line.slice(1));
    } else if (line.startsWith(' ') || (line.length === 0 && currentPath)) {
      oldContent.push(line);
      newContent.push(line);
    }
  }

  if (currentPath) {
    changes.push({
      path: currentPath,
      oldContent: oldContent.join('\n'),
      newContent: newContent.join('\n'),
      changeType: 'modify'
    });
  }

  return changes;
}

/**
 * 确定风险等级
 */
function determineRiskLevel(changes) {
  let riskLevel = 'low';

  for (const change of changes) {
    const path = change.path || '';
    
    // 高风险文件
    if (path.includes('package.json') || 
        path.includes('.env') || 
        path.includes('config') ||
        path.includes('security') ||
        path.includes('auth')) {
      riskLevel = 'high';
    }
    // 中风险
    else if (path.endsWith('.js') || path.endsWith('.ts')) {
      if (riskLevel !== 'high') {
        riskLevel = 'medium';
      }
    }
    // 删除操作
    if (change.changeType === 'delete') {
      riskLevel = 'high';
    }
  }

  return riskLevel;
}

/**
 * 提取文件修改建议（简化版）
 */
function extractFileModifications(replyText) {
  const modifications = [];

  // 简单的文件名检测
  const filePatterns = [
    /`(?:src|lib|bin|test|config)\/[^\n`]+\.(?:js|ts|jsx|tsx|json|md)`/g,
    /File:\s*`([^`]+)`/g,
    /`(?:file|path):\s*([^\n`]+)`/gi
  ];

  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(replyText)) !== null) {
      const path = match[1].trim();
      if (path && !modifications.find(m => m.path === path)) {
        modifications.push({ path });
      }
    }
  }

  return modifications;
}

module.exports = {
  hasPatchProposal,
  parsePatchProposal,
  extractFileModifications,
  parsePatchProposal
};