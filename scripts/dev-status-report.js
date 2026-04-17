const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, '.workbuddy', 'auto-dev-status.md');
const queueCandidates = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

const priorities = [
  {
    id: 'P0-2',
    title: '补齐扩展到本地服务的端到端回归测试',
    reason: '2026-04-17 已重新验证浏览器启动自动拉起链路，但当前关键链路仍主要依赖人工验证，回归成本高。',
    files: [
      'chromevideo/background.js',
      'chromevideo/offscreen.js',
      'chromevideo/host/host.js',
      'chromevideo/host/install_host.js',
      'queue-server/index.js'
    ],
    acceptance: [
      '至少覆盖扩展加载、Native Host 连通、Queue Server 健康检查、Web Console 连接四条链路',
      '测试结果可在本地脚本或 CI 中复用'
    ]
  },
  {
    id: 'P1-1',
    title: '增加安装自检与诊断输出',
    reason: '当前安装步骤仍偏开发者视角，用户遇到 Native Host、端口或依赖问题时定位成本高。',
    files: [
      'validate-environment.js',
      'chromevideo/host/install_host.js',
      'README.md'
    ],
    acceptance: [
      '单条命令输出扩展 ID、Native Host 安装位置、端口状态、缺失依赖',
      '失败时给出可执行修复步骤'
    ]
  },
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
    '- 浏览器启动场景下服务自动拉起已在 2026-04-17 通过真实验证，当前更需要把这条链路固化为可复用回归测试。',
    '',
    '## 最近完成',
    '',
    '- P0-1 已完成：`chromevideo/host/install_host.js` 现已支持从浏览器 profile 自动识别扩展 ID，并写入 Chromium / Chrome for Testing 所需的 Native Messaging 清单路径。',
    '- 2026-04-17 实测：仅打开带扩展的 Chromium，12 秒内 `Queue Server` 与 `Web Console` 均自动拉起。',
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
  lines.push('- 先把“扩展加载 -> Native Host -> Queue Server/Web Console”整理成可重复执行的回归脚本。');
  lines.push('- 功能改动完成后，先验证，再提交。');
  lines.push('');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exit(1);
});
