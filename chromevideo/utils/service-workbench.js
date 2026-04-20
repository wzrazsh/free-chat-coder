(function registerServiceWorkbench(globalScope) {
  const EVENTS_KEY = 'serviceWorkbenchEvents';
  const MAX_EVENTS = 8;

  const ACTION_LABELS = {
    start_queue: '请求启动 Queue Server',
    stop_queue: '请求停止 Queue Server',
    start_web: '请求启动 Web Console',
    stop_web: '请求停止 Web Console',
    open_web: '打开 Web Console',
    open_deepseek: '打开 DeepSeek 聊天页',
    test_dom_error: '记录一次 DOM 错误',
    refresh: '刷新服务诊断'
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatTimestamp(value) {
    if (!value) {
      return '刚刚';
    }

    try {
      return new Date(value).toLocaleString();
    } catch (error) {
      return String(value);
    }
  }

  function getStatusLabel(isAlive) {
    return isAlive ? '运行中' : '未运行';
  }

  function getPillClass(state) {
    if (state === 'ok') {
      return 'ok';
    }

    if (state === 'warning' || state === 'warn') {
      return 'warn';
    }

    if (state === 'error') {
      return 'error';
    }

    return 'neutral';
  }

  async function readEvents() {
    try {
      const data = await chrome.storage.local.get([EVENTS_KEY]);
      return Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    } catch (error) {
      return [];
    }
  }

  async function writeEvents(events) {
    await chrome.storage.local.set({
      [EVENTS_KEY]: events.slice(0, MAX_EVENTS)
    });
  }

  async function appendEvent(event) {
    const currentEvents = await readEvents();
    const signature = event.signature || `${event.level || 'info'}:${event.title}:${event.detail || ''}`;
    const alreadyRecorded = currentEvents.some((item) => item.signature === signature);

    if (alreadyRecorded) {
      return currentEvents;
    }

    const nextEvents = [{
      id: event.id || `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level: event.level || 'info',
      title: event.title || '服务事件',
      detail: event.detail || '',
      timestamp: event.timestamp || new Date().toISOString(),
      signature
    }, ...currentEvents].slice(0, MAX_EVENTS);

    await writeEvents(nextEvents);
    return nextEvents;
  }

  function buildCommandSummary(status) {
    if (!status?.attemptedCommands?.length) {
      return '未触发自动拉起命令';
    }

    const resultMap = new Map((status.commandResults || []).map((item) => [item.command, item]));
    return status.attemptedCommands.map((command) => {
      const result = resultMap.get(command);
      const suffix = result?.ok ? '成功' : (result?.error ? `失败: ${result.error}` : '已请求');

      if (command === 'start_queue') {
        return `Queue Server ${suffix}`;
      }

      if (command === 'start_web') {
        return `Web Console ${suffix}`;
      }

      return `${command} ${suffix}`;
    }).join(' · ');
  }

  function buildBanner(state) {
    if (state.hostError) {
      return {
        className: 'error',
        title: 'Native Host 连接异常',
        text: state.hostError,
        meta: '扩展页面已收到连接失败信号，请优先检查 Host 安装和浏览器权限。'
      };
    }

    if (!state.bootstrapStatus) {
      return {
        className: 'neutral',
        title: '自动拉起诊断',
        text: '等待后台完成首次服务检查。',
        meta: '点击“刷新”可立即重新请求一次状态和启动诊断。'
      };
    }

    const bootstrapClassName = getPillClass(state.bootstrapStatus.state);
    const checkedAt = formatTimestamp(state.bootstrapStatus.checkedAt);

    return {
      className: bootstrapClassName,
      title: '自动拉起诊断',
      text: state.bootstrapStatus.message || '后台已完成一次服务检查。',
      meta: `上次检查 ${checkedAt} · ${buildCommandSummary(state.bootstrapStatus)}`
    };
  }

  function renderEvents(events) {
    if (!events.length) {
      return '<div class="workbench-empty">还没有共享服务事件。执行一次启动、停止或刷新后，这里会显示最近诊断。</div>';
    }

    return events.map((event) => `
      <div class="workbench-event ${escapeHtml(event.level || 'info')}">
        <div class="workbench-event-marker"></div>
        <div class="workbench-event-body">
          <div class="workbench-event-title">${escapeHtml(event.title)}</div>
          ${event.detail ? `<div class="workbench-event-detail">${escapeHtml(event.detail)}</div>` : ''}
          <div class="workbench-event-time">${escapeHtml(formatTimestamp(event.timestamp))}</div>
        </div>
      </div>
    `).join('');
  }

  function createServiceWorkbench(options = {}) {
    const root = typeof options.root === 'string'
      ? document.getElementById(options.root)
      : options.root;

    if (!root) {
      throw new Error('serviceWorkbench root element not found');
    }

    const callbacks = {
      onCommand: options.onCommand || (() => {}),
      onOpenWeb: options.onOpenWeb || (() => {}),
      onOpenDeepSeek: options.onOpenDeepSeek || (() => {}),
      onTestDomError: options.onTestDomError || (() => {}),
      onRefresh: options.onRefresh || (() => {})
    };

    const state = {
      queueAlive: false,
      queuePort: null,
      webAlive: false,
      hostConnected: false,
      bootstrapStatus: null,
      hostError: '',
      events: [],
      hasReceivedStatus: false
    };

    let storageListener = null;

    function render() {
      const banner = buildBanner(state);
      const queueBadge = state.queueAlive ? `:${state.queuePort || '8080+'}` : ':8080+';

      root.innerHTML = `
        <div class="workbench-shell">
          <div class="workbench-head">
            <div>
              <h4>Service Workbench</h4>
              <p>统一查看服务状态、常用操作和最近一次启动诊断。</p>
            </div>
            <button type="button" class="workbench-refresh" data-workbench-action="refresh">刷新</button>
          </div>

          <div class="workbench-overview">
            <span class="workbench-pill ${state.queueAlive ? 'ok' : 'warn'}">Queue ${escapeHtml(getStatusLabel(state.queueAlive))}</span>
            <span class="workbench-pill ${state.webAlive ? 'ok' : 'warn'}">Web ${escapeHtml(getStatusLabel(state.webAlive))}</span>
            <span class="workbench-pill ${state.hostConnected ? 'ok' : 'error'}">Host ${escapeHtml(state.hostConnected ? '已连接' : '未连接')}</span>
          </div>

          <div class="workbench-grid">
            <section class="workbench-card">
              <div class="workbench-card-head">
                <div>
                  <h5>Queue Server</h5>
                  <div class="workbench-card-meta">
                    <span>${escapeHtml(getStatusLabel(state.queueAlive))}</span>
                    <span>监听端口 ${escapeHtml(queueBadge)}</span>
                  </div>
                </div>
                <span class="workbench-card-label">${escapeHtml(state.queueAlive ? 'online' : 'offline')}</span>
              </div>
              <div class="workbench-card-actions">
                <button type="button" class="workbench-btn start" data-command="start_queue">Start</button>
                <button type="button" class="workbench-btn stop" data-command="stop_queue">Stop</button>
              </div>
            </section>

            <section class="workbench-card">
              <div class="workbench-card-head">
                <div>
                  <h5>Web Console</h5>
                  <div class="workbench-card-meta">
                    <span>${escapeHtml(getStatusLabel(state.webAlive))}</span>
                    <span>固定端口 :5173</span>
                  </div>
                </div>
                <span class="workbench-card-label">${escapeHtml(state.webAlive ? 'online' : 'offline')}</span>
              </div>
              <div class="workbench-card-actions">
                <button type="button" class="workbench-btn start" data-command="start_web">Start</button>
                <button type="button" class="workbench-btn stop" data-command="stop_web">Stop</button>
                <button type="button" class="workbench-btn link" data-workbench-action="open_web">Open</button>
              </div>
            </section>

            <section class="workbench-card">
              <div class="workbench-card-head">
                <div>
                  <h5>Quick Actions</h5>
                  <div class="workbench-card-meta">
                    <span>直接打开对话页或记录一次扩展 DOM 错误。</span>
                  </div>
                </div>
              </div>
              <div class="workbench-card-actions">
                <button type="button" class="workbench-btn link" data-workbench-action="open_deepseek">DeepSeek</button>
                <button type="button" class="workbench-btn warn" data-workbench-action="test_dom_error">模拟 DOM 错误</button>
              </div>
            </section>
          </div>

          <section class="workbench-banner ${escapeHtml(banner.className)}">
            <div class="workbench-banner-title">${escapeHtml(banner.title)}</div>
            <div class="workbench-banner-text">${escapeHtml(banner.text)}</div>
            <div class="workbench-banner-meta">${escapeHtml(banner.meta)}</div>
          </section>

          <section class="workbench-events-panel">
            <div class="workbench-section-head">
              <h5>Recent Events</h5>
              <span>${escapeHtml(String(state.events.length))} 条</span>
            </div>
            <div class="workbench-events">${renderEvents(state.events)}</div>
          </section>
        </div>
      `;

      root.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('click', async () => {
          const command = button.getAttribute('data-command');
          await appendEvent({
            level: 'info',
            title: ACTION_LABELS[command] || '执行服务命令',
            detail: '来自共享 Service Workbench。',
            signature: `command:${command}:${Date.now()}`
          });
          callbacks.onCommand(command);
        });
      });

      root.querySelectorAll('[data-workbench-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.getAttribute('data-workbench-action');
          if (action === 'refresh') {
            await appendEvent({
              level: 'info',
              title: ACTION_LABELS.refresh,
              detail: '已请求刷新服务状态和自动拉起诊断。',
              signature: `action:refresh:${Date.now()}`
            });
            callbacks.onRefresh();
            return;
          }

          if (action === 'open_web') {
            await appendEvent({
              level: 'info',
              title: ACTION_LABELS.open_web,
              detail: '将打开本地 Web Console 页。',
              signature: `action:open_web:${Date.now()}`
            });
            callbacks.onOpenWeb();
            return;
          }

          if (action === 'open_deepseek') {
            await appendEvent({
              level: 'info',
              title: ACTION_LABELS.open_deepseek,
              detail: '将打开 DeepSeek 聊天页。',
              signature: `action:open_deepseek:${Date.now()}`
            });
            callbacks.onOpenDeepSeek();
            return;
          }

          if (action === 'test_dom_error') {
            await appendEvent({
              level: 'warn',
              title: ACTION_LABELS.test_dom_error,
              detail: '用于验证 auto-evolve 错误采样链路。',
              signature: `action:test_dom_error:${Date.now()}`
            });
            callbacks.onTestDomError();
          }
        });
      });
    }

    async function syncEvents() {
      state.events = await readEvents();
      render();
    }

    async function setStatus(nextStatus = {}) {
      const normalizedStatus = {
        queueAlive: !!nextStatus.queueAlive,
        queuePort: nextStatus.queuePort || null,
        webAlive: !!nextStatus.webAlive
      };

      if (
        state.hasReceivedStatus &&
        (
          state.queueAlive !== normalizedStatus.queueAlive ||
          state.queuePort !== normalizedStatus.queuePort ||
          state.webAlive !== normalizedStatus.webAlive
        )
      ) {
        const details = [
          `Queue ${getStatusLabel(normalizedStatus.queueAlive)}${normalizedStatus.queueAlive ? ` :${normalizedStatus.queuePort || '8080+'}` : ''}`,
          `Web ${getStatusLabel(normalizedStatus.webAlive)}`
        ].join(' · ');

        await appendEvent({
          level: normalizedStatus.queueAlive || normalizedStatus.webAlive ? 'info' : 'warn',
          title: '服务状态已更新',
          detail: details,
          signature: `status:${normalizedStatus.queueAlive}:${normalizedStatus.queuePort || 'na'}:${normalizedStatus.webAlive}`
        });
      }

      state.queueAlive = normalizedStatus.queueAlive;
      state.queuePort = normalizedStatus.queuePort;
      state.webAlive = normalizedStatus.webAlive;
      state.hasReceivedStatus = true;
      render();
    }

    async function setBootstrapStatus(status) {
      const previousCheckedAt = state.bootstrapStatus?.checkedAt || null;
      state.bootstrapStatus = status || null;
      render();

      if (status?.checkedAt && status.checkedAt !== previousCheckedAt) {
        await appendEvent({
          level: status.state === 'error' ? 'error' : (status.state === 'warning' ? 'warn' : 'info'),
          title: '自动拉起诊断已更新',
          detail: status.message || '后台完成了一次服务检查。',
          timestamp: status.checkedAt,
          signature: `bootstrap:${status.state || 'unknown'}:${status.checkedAt}:${status.message || ''}`
        });
      }
    }

    function setHostConnected(connected) {
      state.hostConnected = !!connected;
      render();
    }

    async function setHostError(message) {
      const normalizedMessage = message ? String(message) : '';

      if (normalizedMessage && normalizedMessage !== state.hostError) {
        await appendEvent({
          level: 'error',
          title: 'Native Host 连接异常',
          detail: normalizedMessage,
          signature: `host_error:${normalizedMessage}`
        });
      }

      state.hostError = normalizedMessage;
      render();
    }

    async function load() {
      await syncEvents();

      if (chrome.storage?.onChanged && !storageListener) {
        storageListener = (changes, areaName) => {
          if (areaName !== 'local' || !changes[EVENTS_KEY]) {
            return;
          }

          state.events = Array.isArray(changes[EVENTS_KEY].newValue)
            ? changes[EVENTS_KEY].newValue
            : [];
          render();
        };

        chrome.storage.onChanged.addListener(storageListener);
      }

      render();
    }

    function destroy() {
      if (storageListener && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageListener);
        storageListener = null;
      }
    }

    render();

    return {
      load,
      destroy,
      setStatus,
      setBootstrapStatus,
      setHostConnected,
      setHostError,
      syncEvents
    };
  }

  globalScope.serviceWorkbench = {
    createServiceWorkbench
  };
})(globalThis);
