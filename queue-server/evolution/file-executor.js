const fs = require('fs');
const path = require('path');

// 从环境变量或默认路径获取工作区根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../');

const fileExecutor = {
  readFile(params) {
    if (!params || !params.path) {
      return { success: false, error: 'Missing path parameter' };
    }
    const filePath = path.resolve(WORKSPACE_ROOT, params.path);
    // 安全检查：确保路径在工作区内
    if (!filePath.startsWith(WORKSPACE_ROOT)) {
      return { success: false, error: 'Path outside workspace' };
    }
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${params.path}` };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      return {
        success: true,
        result: {
          path: params.path,
          content,
          size: stat.size,
          lastModified: stat.mtime.toISOString()
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  writeFile(params) {
    if (!params || !params.path || typeof params.content !== 'string') {
      return { success: false, error: 'Missing path or content parameter' };
    }
    const filePath = path.resolve(WORKSPACE_ROOT, params.path);
    if (!filePath.startsWith(WORKSPACE_ROOT)) {
      return { success: false, error: 'Path outside workspace' };
    }
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 备份
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, filePath + '.bak');
      }
      fs.writeFileSync(filePath, params.content, 'utf8');
      return {
        success: true,
        result: {
          path: params.path,
          size: params.content.length,
          backed: fs.existsSync(filePath + '.bak')
        }
      };
    } catch (err) {
      // 回滚
      if (fs.existsSync(filePath + '.bak')) {
        fs.copyFileSync(filePath + '.bak', filePath);
      }
      return { success: false, error: err.message };
    }
  },

  listFiles(params) {
    const relativePath = (params && params.path) ? params.path : '.';
    const dirPath = path.resolve(WORKSPACE_ROOT, relativePath);
    if (!dirPath.startsWith(WORKSPACE_ROOT)) {
      return { success: false, error: 'Path outside workspace' };
    }
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: `Directory not found: ${relativePath}` };
    }
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.join(relativePath, e.name)
      }));
      return { success: true, result: { path: relativePath, files } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = fileExecutor;
