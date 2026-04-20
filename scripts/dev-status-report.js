const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, '.workbuddy', 'auto-dev-status.md');
const queueCandidates = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

const priorities = [
  {
    id: 'P0-3',
    title: '引入 DeepSeek Web Zero-Token Provider',
    reason: '当前剩余 blocker 已收敛为两步：先用真实已登录的 DeepSeek chat 页面重新采集 auth snapshot，再在此基础上继续验证 live request contract。onboarding 现已能拒绝 `/sign_in`、APMPLUS / `__tea_*` telemetry token，以及短 session metadata 假阳性。',
    files: [
      'doc/deepseek-zero-token-integration-20260417.md',
      'queue-server/providers/deepseek-web/',
      'queue-server/routes/tasks.js',
      'queue-server/websocket/handler.js',
      'queue-server/conversations/store.js'
    ],
    acceptance: [
      '能安全捕获并存储 DeepSeek Web 所需的 cookie / bearer / userAgent',
      '新增 provider 后，Queue Server 可直接完成至少一轮 DeepSeek 文本问答',
      '自动进化任务可优先走 deepseek-web 或在失败时明确回退到 extension-dom'
    ],
    steps: [
      '先运行 `node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser`，确认输出为 `readyToPersist=true`，且不再落入 `/sign_in`、telemetry token 或短 session metadata 假阳性。',
      '如果 onboarding 提示当前仍在 `/sign_in`，或保存的 snapshot 仍是 `telemetry_token` / `incomplete_snapshot`，先在 workspace browser profile 中重新登录并确认聊天输入框可见，再重复 onboard。',
      '拿到真实可用的 auth snapshot 后，再执行 `node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"`；如果 probe 仍返回 `DEEPSEEK_AUTH_INVALID` / `INVALID_TOKEN`，再去比对浏览器真实请求里的 headers / body / endpoint。',
      'provider 实测稳定后，再继续补会话/UI 可视化或更广的端到端回归 coverage。'
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
      'chromevideo/sidepanel.html',
      'chromevideo/utils/'
    ],
    acceptance: [
      '服务状态、启动日志和常用操作有统一入口',
      '用户不需要在 popup 和 sidepanel 之间来回切换才能完成基本排障'
    ],
    steps: [
      '仅在 zero-token provider 最小链路可用后再继续推进该项。',
      '保持 popup / sidepanel 作为工作台入口，不要在这里承载敏感凭证。'
    ]
  },
  {
    id: 'P2-2',
    title: '补齐任务模板、工作区配置与失败记录入口',
    reason: '统一工作台之后，下一步体验缺口是常用任务入口和近期失败排障信息仍不够集中。',
    files: [
      'chromevideo/sidepanel.js',
      'web-console/src/App.tsx',
      'queue-server/data/test-reports/'
    ],
    acceptance: [
      '常用任务模板和工作区配置可从主入口直接触达',
      '最近失败记录和关键日志不需要翻文件即可查看'
    ],
    steps: [
      '在共享工作台稳定后再补该项，避免和 zero-token provider 并行打散精力。',
      '失败记录优先消费已有 `queue-server/data/test-reports/` 和验证审计数据。'
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
    '- P0-3 仍处于 Phase 3，但 auth 诊断基线已更新：onboarding / probe 现在会拒绝 `/sign_in`、APMPLUS / `__tea_*` telemetry token，以及短 session metadata 假阳性；当前 `.browser-profile` 仍可能停留在 `/sign_in`，必须先拿到真实已登录 chat 页面采集的 snapshot，再继续判断是否仍存在 `INVALID_TOKEN` 的请求契约问题。',
    '',
    '## 最近完成',
    '',
    '- P0-1 已完成：`chromevideo/host/install_host.js` 现已支持从浏览器 profile 自动识别扩展 ID，并写入 Chromium / Chrome for Testing 所需的 Native Messaging 清单路径。',
    '- P0-2 已完成：新增 `test-playwright-e2e.js`，可在真实 `.browser-profile` 上验证扩展加载、Native Host 拉起、Queue `/health`、Web Console 与 offscreen WebSocket 链路。',
    '- P1-1 已完成：`validate-environment.js` 现已输出扩展 ID、Native Host manifest 位置、浏览器 / Node 模块依赖与 Queue/Web Console 端口诊断，并给出可执行修复步骤。',
    '- P1-2 已完成：自动进化链路现已具备 preflight/post-change 最小验证、失败回滚、验证审计持久化，以及 Web Console 最近审计历史展示。',
    '- P0-3 已完成首个 Phase 2 单元：`queue-server/providers/deepseek-web/` 现已具备最小 HTTP transport、JSON/SSE 响应解析、端点回退、本机 auth snapshot 复用，以及 provider session 元数据写回任务/会话更新的基础能力；并已补齐本地 fake-server 验证。',
    '- P0-3 已完成 Phase 3 首个切换：`auto_evolve` 任务现已默认优先使用 `deepseek-web`，失败时会明确回退到 `extension-dom`。',
    '- P0-3 已补齐 live provider probe CLI：`scripts/verify-deepseek-web-provider.js` 可复用本机 auth snapshot 发起一次真实文本问答，并输出脱敏诊断结果。',
    '- P0-3 已补强 live auth 诊断：onboarding 现在会拒绝 AWS WAF challenge、`/sign_in`、APMPLUS / `__tea_*` telemetry token，以及短 session metadata 假阳性；probe 也会把这类快照显式标记为 `DEEPSEEK_AUTH_LOGGED_OUT` / `DEEPSEEK_AUTH_TOKEN_SOURCE_INVALID` / `DEEPSEEK_AUTH_INCOMPLETE`，避免继续拿无效 snapshot 追查 `INVALID_TOKEN`。',
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
    if (Array.isArray(priority.steps) && priority.steps.length > 0) {
      lines.push('- 建议步骤：');
      for (const step of priority.steps) {
        lines.push(`  - ${step}`);
      }
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
  lines.push('- 直接继续 P0-3：先读 `doc/deepseek-zero-token-integration-20260417.md`，再运行 `node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser`，确认当前不是 `/sign_in`，且输出 `readyToPersist=true`。');
  lines.push('- 优先检查 `queue-server/providers/deepseek-web/`、`queue-server/routes/tasks.js`、`queue-server/websocket/handler.js`、`queue-server/conversations/store.js`。');
  lines.push('- 如果 onboarding 或 probe 仍提示 `logged_out` / `telemetry_token` / `incomplete_snapshot`，先在 workspace browser profile 中重新登录 DeepSeek，并确认聊天输入框出现后再重跑 onboard。');
  lines.push('- 只有在拿到真实可用 snapshot 后，再执行 `node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"`；若此时仍返回 `DEEPSEEK_AUTH_INVALID`，再重点比对浏览器真实请求和 `queue-server/providers/deepseek-web/client.js` 的 endpoint、Authorization/Cookie 组合、额外 headers，以及 request body 字段。');
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
