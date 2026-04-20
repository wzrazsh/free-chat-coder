/**
 * 管理需要用户确认的危险动作
 *
 * 审批优先级：
 *   1. 自动进化任务（options.autoEvolve === true）→ 自动批准
 *   2. AUTO_CONFIRM=true 环境变量 → 全部自动批准（仅用于开发测试）
 *   3. 其余情况 → 通过 WebSocket 推送到 Web 控制台弹窗，3 分钟超时拒绝
 */
class ConfirmManager {
  constructor() {
    this.pendingConfirms = new Map();

    // 进化动作白名单（符合条件时自动批准）
    this.AUTO_EVOLVE_WHITELIST = [
      'evolve_handler',
      'evolve_extension',
      'evolve_server'
    ];

    // Web 控制台 WebSocket 客户端集合（由 websocket/handler.js 注入）
    this._webClients = null;
    this._eventBroadcaster = null;
  }

  /**
   * 由 websocket/handler.js 在启动后调用，注入 web 客户端集合引用
   * @param {Set} webClientsRef - webClients Set 的引用（引用传递，自动跟踪变化）
   */
  setWebClients(webClientsRef) {
    this._webClients = webClientsRef;
  }

  /**
   * 注入统一事件广播器（可同时广播到 Web 和扩展）
   * @param {(payload: object) => void} broadcaster
   */
  setEventBroadcaster(broadcaster) {
    this._eventBroadcaster = broadcaster;
  }

  /**
   * 请求确认
   * @param {Object} actionInfo { taskId, action, params, riskLevel, task? }
   * @param {Function} onResponse 回调 (approved: boolean) => void
   */
  requestConfirm(actionInfo, onResponse) {
    if (process.env.MANUAL_CONFIRM !== 'true') {
      console.log(`[ConfirmManager] Auto-approving action: ${actionInfo.action} (manual confirm disabled)`);
      return onResponse(true);
    }

    // 优先级 1：自动进化任务自动批准
    if (this.shouldAutoApprove(actionInfo)) {
      console.log(`[ConfirmManager] Auto-approving evolution action: ${actionInfo.action} (auto-evolve task)`);
      return onResponse(true);
    }

    // 优先级 2：开发模式全量自动批准
    if (process.env.AUTO_CONFIRM === 'true') {
      console.log(`[ConfirmManager] Auto-approving action: ${actionInfo.action} (AUTO_CONFIRM=true)`);
      return onResponse(true);
    }

    this._enqueueConfirm(actionInfo, onResponse);
  }

  /**
   * 创建一个仅用于验证/联调的待审批项
   * @param {Object} actionInfo
   * @returns {string} confirmId
   */
  createTestConfirm(actionInfo) {
    return this._enqueueConfirm(actionInfo, () => {});
  }

  _enqueueConfirm(actionInfo, onResponse) {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // 优先级 3：推送到 Web 控制台等待人工审批
    this.pendingConfirms.set(confirmId, { actionInfo, onResponse, createdAt: Date.now() });
    console.log(`[ConfirmManager] Action '${actionInfo.action}' requires confirmation. ID: ${confirmId}`);

    // 推送到所有 web 客户端（弹出审批弹窗）
    this._broadcastConfirmRequest(confirmId, actionInfo);

    // 超时拒绝（3 分钟）
    const timer = setTimeout(() => {
      if (this.pendingConfirms.has(confirmId)) {
        console.log(`[ConfirmManager] Confirmation timeout for ${confirmId}`);
        const { onResponse: cb } = this.pendingConfirms.get(confirmId);
        this.pendingConfirms.delete(confirmId);
        this._broadcastEvent({
          type: 'confirm_resolved',
          confirmId,
          approved: false,
          reason: 'timeout'
        });
        cb(false);
      }
    }, 180000);

    // 防止 timer 阻止进程退出
    if (timer.unref) timer.unref();

    return confirmId;
  }

  /**
   * 检查是否应该自动批准该动作
   */
  shouldAutoApprove(actionInfo) {
    if (!this.AUTO_EVOLVE_WHITELIST.includes(actionInfo.action)) {
      return false;
    }

    // 兼容两种传入格式：task 对象直接有 options，或 task 就是 options
    const task = actionInfo.task;
    if (!task) return false;

    // 格式 1：task.options.autoEvolve（来自 queueManager 的完整任务对象）
    if (task.options && task.options.autoEvolve === true) {
      return true;
    }

    // 格式 2：task.autoEvolve（旧版直接挂载）
    if (task.autoEvolve === true) {
      return true;
    }

    // 格式 3：prompt 包含自动进化标识
    if (task.prompt && task.prompt.includes('[自动进化]')) {
      return true;
    }

    return false;
  }

  /**
   * 向 Web 控制台广播审批请求
   * @private
   */
  _broadcastConfirmRequest(confirmId, actionInfo) {
    const payload = {
      type: 'confirm_request',
      confirmId,
      action: actionInfo.action,
      riskLevel: actionInfo.riskLevel,
      params: actionInfo.params,
      taskId: actionInfo.taskId,
      timestamp: new Date().toISOString()
    };

    if (this._eventBroadcaster) {
      this._eventBroadcaster(payload);
      return;
    }

    if (!this._webClients || this._webClients.size === 0) {
      console.warn(`[ConfirmManager] No web clients connected; confirm ${confirmId} will timeout in 3 min`);
      return;
    }

    const payloadString = JSON.stringify(payload);

    let sent = 0;
    for (const ws of this._webClients) {
      try {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send(payloadString);
          sent++;
        }
      } catch (err) {
        console.warn(`[ConfirmManager] Failed to send to web client:`, err.message);
      }
    }
    console.log(`[ConfirmManager] Confirm request sent to ${sent} web client(s)`);
  }

  _broadcastEvent(payload) {
    if (this._eventBroadcaster) {
      this._eventBroadcaster(payload);
      return;
    }

    if (!this._webClients || this._webClients.size === 0) {
      return;
    }

    const payloadString = JSON.stringify(payload);
    for (const ws of this._webClients) {
      try {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send(payloadString);
        }
      } catch (err) {
        console.warn('[ConfirmManager] Failed to broadcast confirm event:', err.message);
      }
    }
  }

  /**
   * Web 控制台或 REST API 响应确认结果
   * @param {string} confirmId
   * @param {boolean} approved
   * @returns {boolean} 是否找到对应的 pending confirm
   */
  respondConfirm(confirmId, approved) {
    if (this.pendingConfirms.has(confirmId)) {
      const { onResponse } = this.pendingConfirms.get(confirmId);
      this.pendingConfirms.delete(confirmId);
      console.log(`[ConfirmManager] Confirm ${confirmId} responded: ${approved}`);
      onResponse(approved);
      return true;
    }
    return false;
  }

  /**
   * 获取所有待审批的请求摘要（供 REST API 查询）
   */
  getPendingList() {
    return Array.from(this.pendingConfirms.entries()).map(([id, { actionInfo, createdAt }]) => ({
      confirmId: id,
      action: actionInfo.action,
      riskLevel: actionInfo.riskLevel,
      params: actionInfo.params,
      taskId: actionInfo.taskId,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + 180000).toISOString()
    }));
  }
}

module.exports = new ConfirmManager();
