const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('../../shared/config');

const WORKSPACE_ROOT = config.workspace.path;

function extractCodeBlocks(text) {
  const blocks = [];

  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push({
      language: (match[1] || '').toLowerCase(),
      code: match[2].trim()
    });
  }

  if (blocks.length > 0) {
    return blocks;
  }

  const langLineRegex = /^(javascript|typescript|python|html|css|json|jsx|tsx|java|cpp|c|go|rust|ruby|php|sql|shell|bash|yaml|xml)\s*$/gmi;
  let langMatch;
  while ((langMatch = langLineRegex.exec(text)) !== null) {
    const lang = langMatch[1].toLowerCase();
    const afterLang = text.substring(langMatch.index + langMatch[0].length);
    const codeStart = afterLang
      .replace(/^\s*\n/, '')
      .replace(/^(复制|下载|Copy|Download)\s*\n/gmi, '');

    const code = extractCodeBody(codeStart, lang);
    if (code.length > 50) {
      blocks.push({ language: lang, code });
      break;
    }
  }

  return blocks;
}

function extractCodeBody(text, lang) {
  const lines = text.split('\n');
  const codeLines = [];
  let braceDepth = 0;
  let hasBraces = false;
  let foundFirstBrace = false;
  let foundModuleExports = false;
  let moduleExportsBraceDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isExplanationText(trimmed, i, codeLines, foundFirstBrace, lang)) {
      break;
    }

    for (const ch of line) {
      if (ch === '{') { braceDepth++; hasBraces = true; foundFirstBrace = true; }
      if (ch === '}') braceDepth--;
    }

    if (/module\.exports\s*=/.test(line)) {
      foundModuleExports = true;
      moduleExportsBraceDepth = braceDepth;
    }

    codeLines.push(line);

    if (foundModuleExports && braceDepth < moduleExportsBraceDepth && i > 5) {
      break;
    }

    if (!foundModuleExports && hasBraces && foundFirstBrace && braceDepth <= 0 && i > 5) {
      let remaining = lines.slice(i + 1).join('\n');
      if (/module\.exports\s*=/.test(remaining)) {
        continue;
      }
      break;
    }
  }

  return codeLines.join('\n').trim();
}

function isExplanationText(trimmed, lineIndex, codeLines, foundFirstBrace, lang) {
  if (lineIndex < 3) return false;
  if (!foundFirstBrace) return false;
  if (trimmed === '') return false;

  if (/^(Key\s+Features|Features?\s+Added|This\s+(improved|handler|code)|Usage|Explanation|Note[s]?|How\s+to|Important|The\s+handler|The\s+code|The\s+above|Above\s+code)/i.test(trimmed)) {
    return true;
  }

  if (/^\d+\.\s+[A-Z]/.test(trimmed) && lineIndex > 10) {
    const prevLines = codeLines.slice(-3).join('');
    if (!prevLines.includes('{') && !prevLines.includes('}') && !prevLines.includes(';')) {
      return true;
    }
  }

  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*:\s/.test(trimmed) && !trimmed.includes('=') && !trimmed.includes('{') && lineIndex > 10) {
    return true;
  }

  return false;
}

function resolveTargetPath(task) {
  const prompt = (task.prompt || '').toLowerCase();
  const options = task.options || {};

  if (options.targetFile) {
    return path.resolve(WORKSPACE_ROOT, options.targetFile);
  }

  if (prompt.includes('custom-handler') || prompt.includes('customhandler')) {
    return path.join(WORKSPACE_ROOT, 'queue-server', 'custom-handler.js');
  }
  if (prompt.includes('content.js') || prompt.includes('content script')) {
    return path.join(WORKSPACE_ROOT, 'chromevideo', 'content.js');
  }
  if (prompt.includes('background.js') || prompt.includes('background')) {
    return path.join(WORKSPACE_ROOT, 'chromevideo', 'background.js');
  }
  if (prompt.includes('offscreen.js') || prompt.includes('offscreen')) {
    return path.join(WORKSPACE_ROOT, 'chromevideo', 'offscreen.js');
  }
  if (prompt.includes('handler.js') || prompt.includes('websocket')) {
    return path.join(WORKSPACE_ROOT, 'queue-server', 'websocket', 'handler.js');
  }

  return null;
}

function writeCodeToFiles(task, result) {
  const blocks = extractCodeBlocks(result);
  if (blocks.length === 0) {
    return { success: false, reason: 'no_code_blocks_found', filesWritten: [] };
  }

  const targetPath = resolveTargetPath(task);
  const filesWritten = [];

  if (targetPath && blocks.length >= 1) {
    const code = blocks[0].code;
    const backupPath = targetPath + '.bak';

    if (targetPath.endsWith('.js')) {
      try {
        new vm.Script(code);
      } catch (syntaxErr) {
        console.error(`[CodeWriter] Syntax error in extracted code, skipping write: ${syntaxErr.message}`);
        return { success: false, reason: 'syntax_error', error: syntaxErr.message, filesWritten: [] };
      }
    }

    try {
      if (fs.existsSync(targetPath)) {
        fs.copyFileSync(targetPath, backupPath);
      }

      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetPath, code, 'utf8');
      const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
      filesWritten.push({
        path: relativePath,
        absolutePath: targetPath,
        language: blocks[0].language,
        size: code.length,
        backed: fs.existsSync(backupPath)
      });
      console.log(`[CodeWriter] Wrote code to ${relativePath} (${code.length} bytes)`);
    } catch (err) {
      console.error(`[CodeWriter] Error writing to ${targetPath}:`, err);
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, targetPath);
        console.log(`[CodeWriter] Rolled back to backup`);
      }
      return { success: false, reason: 'write_error', error: err.message, filesWritten };
    }

    if (blocks.length > 1) {
      console.log(`[CodeWriter] ${blocks.length - 1} additional code blocks not auto-written (no target path mapping)`);
    }
  } else if (blocks.length >= 1) {
    const autoDir = path.join(WORKSPACE_ROOT, 'auto-generated');
    if (!fs.existsSync(autoDir)) {
      fs.mkdirSync(autoDir, { recursive: true });
    }

    blocks.forEach((block, index) => {
      const ext = languageToExt(block.language);
      const timestamp = Date.now();
      const fileName = index === 0 ? `generated-${timestamp}${ext}` : `generated-${timestamp}-${index + 1}${ext}`;
      const filePath = path.join(autoDir, fileName);

      try {
        fs.writeFileSync(filePath, block.code, 'utf8');
        const relativePath = path.relative(WORKSPACE_ROOT, filePath);
        filesWritten.push({
          path: relativePath,
          absolutePath: filePath,
          language: block.language,
          size: block.code.length
        });
        console.log(`[CodeWriter] Wrote auto-generated code to ${relativePath} (${block.code.length} bytes)`);
      } catch (err) {
        console.error(`[CodeWriter] Error writing auto-generated file:`, err);
      }
    });
  }

  return {
    success: filesWritten.length > 0,
    filesWritten,
    totalBlocks: blocks.length
  };
}

function languageToExt(lang) {
  const map = {
    javascript: '.js', js: '.js',
    typescript: '.ts', ts: '.ts',
    python: '.py', py: '.py',
    html: '.html',
    css: '.css',
    json: '.json',
    jsx: '.jsx',
    tsx: '.tsx',
    shell: '.sh', bash: '.sh', sh: '.sh',
    sql: '.sql',
    java: '.java',
    cpp: '.cpp', c: '.c',
    go: '.go',
    rust: '.rs',
    ruby: '.rb',
    php: '.php',
    yaml: '.yml', yml: '.yml',
    xml: '.xml',
    markdown: '.md', md: '.md'
  };
  return map[lang] || '.txt';
}

module.exports = { extractCodeBlocks, writeCodeToFiles, resolveTargetPath };
