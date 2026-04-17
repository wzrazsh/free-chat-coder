const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, '.workbuddy', 'auto-dev-status.md');
const queueCandidates = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

const priorities = [
  {
    id: 'P1-2',
    title: '收紧自动进化的验证与回滚',
    reason: '自动进化链路已具备写代码能力，但预验证、结果审计和失败回滚仍不够硬。',
    files: [
      'queue-server/evolution/evolve-executor.js',
      'queue-server/test-validator/',
      'queue-server/actions/confirm-manager.js'
    ],
    acceptance: [
      '进化前自动跑最小验证',
      '失败时能定位到具体变更并触发回滚',
      'Web Console 能查看最近一次进化的验证结果'
    ]
  },
  {
    id: 'P2-1',
    title: '整合 popup / sidepanel 的工作台能力',
    reason: '基础链路稳定后，下一步产品体验差距主要来自入口分散、状态反馈不统一。',
    files: [
      'chromevideo/popup.js',
      'chromevideo/sidepanel.js',
      'chromevideo/popup.html',
      'chromevideo/sidepanel.html'
    ],
    acceptance: [
      '服务状态、启动日志和常用操作有统一入口',
      '用户不需要在 popup 和 sidepanel 之间来回切换才能完成基本排障'
    ]
  }
];

function run(command) {
  try {
    return cp.execSync(command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return '';
  }
}

function httpRequest(options) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({
        ok: true,
        statusCode: res.statusCode,
        body
      }));
    });

    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.end();
  });
}

async function detectQueueServer() {
  for (const port of queueCandidates) {
    const response = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET'
    });

    if (!response.ok) {
      continue;
    }

    try {
      const data = JSON.parse(response.body || '{}');
      return {
        running: true,
        port,
        service: data.service || 'unknown'
      };
    } catch (error) {
      return {
        running: true,
        port,
        service: 'unknown'
      };
    }
  }

  return {
    running: false,
    port: null,
    service: null
  };
}

async function detectWebConsole() {
  const response = await httpRequest({
    hostname: '127.0.0.1',
    port: 5173,
    path: '/',
    method: 'HEAD'
  });

  return {
    running: !!response.ok
  };
}

function buildDirtyList() {
  const status = run('git status --short');
  if (!status) {
    return [];
  }
  return status.split('\n').filter(Boolean);
}

async function main() {
  const branch = run('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const lastCommit = run('git log -1 --pretty=format:%h\\ %s');
  const dirtyFiles = buildDirtyList();
  const queue = await detectQueueServer();
  const webConsole = await detectWebConsole();

  const lines = [
    '# Auto Dev Status',
    '',
    `更新时间：${new Date().toISOString()}`,
    '',
    '## 当前快照',
    '',
    `- 分支：\`${branch}\``,
    `- 最新提交：\`${lastCommit || 'unknown'}\``,
    `- Queue Server：${queue.running ? `运行中（端口 ${queue.port}）` : '未运行'}`,
    `- Web Console：${webConsole.running ? '运行中（5173）' : '未运行'}`,
    `- 工作区变更数：${dirtyFiles.length}`,
    '',
    '## 阶段判断',
    '',
    '- 当前项目已完成扩展、Queue Server、Web Console、自动进化和 Native Host 的基础闭环。',
    '- 当前阶段应定义为“稳定化 + 产品化”，而不是继续堆原型能力。',
    '- 浏览器启动场景下服务自动拉起已在 2026-04-17 完成真实验证，并已补齐可复用的端到端回归脚本。',
    '- 安装自检命令已在 2026-04-17 补齐，可直接输出扩展 ID、Native Host 安装位置、端口状态与修复建议。',
    '',
    '## 最近完成',
    '',
    '- P0-1 已完成：`chromevideo/host/install_host.js` 现已支持从浏览器 profile 自动识别扩展 ID，并写入 Chromium / Chrome for Testing 所需的 Native Messaging 清单路径。',
    '- P0-2 已完成：新增 `test-playwright-e2e.js`，可在真实 `.browser-profile` 上验证扩展加载、Native Host 拉起、Queue `/health`、Web Console 与 offscreen WebSocket 链路。',
    '- P1-1 已完成：`validate-environment.js` 现已输出扩展 ID、Native Host manifest 位置、浏览器 / Node 模块依赖与 Queue/Web Console 端口诊断，并给出可执行修复步骤。',
    '- `scripts/nightly-validate.sh` 已接入该回归测试，在具备浏览器 / Xvfb / 依赖时可自动执行。',
    '',
    '## 当前最高优先任务',
    ''
  ];

  for (const priority of priorities) {
    lines.push(`### ${priority.id} ${priority.title}`);
    lines.push('');
    lines.push(`- 原因：${priority.reason}`);
    lines.push(`- 关联文件：${priority.files.map((file) => `\`${file}\``).join('、')}`);
    lines.push('- 验收标准：');
    for (const item of priority.acceptance) {
      lines.push(`  - ${item}`);
    }
    lines.push('');
  }

  lines.push('## 当前工作区变更');
  lines.push('');
  if (dirtyFiles.length === 0) {
    lines.push('- 无未提交变更');
  } else {
    for (const file of dirtyFiles.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
  }
  lines.push('');
  lines.push('## 下一次进入会话时建议先做的事');
  lines.push('');
  lines.push('- 先读本文件、`README.md` 和 `git status --short`。');
  lines.push('- 直接进入 P1-2：给自动进化链路补最小预执行验证、失败回滚和结果审计。');
  lines.push('- 优先检查 `queue-server/evolution/evolve-executor.js`、`queue-server/test-validator/`、`queue-server/actions/confirm-manager.js`。');
  lines.push('- 功能改动完成后，先跑聚焦验证，再提交。');
  lines.push('');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exit(1);
});
