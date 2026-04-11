/**
 * 管理需要用户确认的危险动作
 * 由于目前控制台还没有做弹出确认的UI，先实现一个自动通过的桩实现
 * 或者默认拒绝高危操作，等待后续迭代完善 UI。
 * 这里我们默认配置项中带有 `autoConfirm: true` 就放行。
 */
class ConfirmManager {
  constructor() {
    this.pendingConfirms = new Map();

    // 自动进化动作白名单（允许自动确认的进化动作）
    this.AUTO_EVOLVE_WHITELIST = [
      'evolve_handler',
      'evolve_extension',
      'evolve_server'
    ];

    // 自动进化任务标识
    this.AUTO_EVOLVE_TASK_PREFIX = '[自动进化任务]';
  }

  /**
   * 请求确认
   * @param {Object} actionInfo { taskId, action, params, riskLevel, task? }
   * @param {Function} onResponse 回调函数 (approved) => void
   */
  requestConfirm(actionInfo, onResponse) {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // 检查是否为自动进化任务
    if (this.shouldAutoApprove(actionInfo)) {
      console.log(`[ConfirmManager] Auto-approving evolution action: ${actionInfo.action} (auto-evolve task)`);
      return onResponse(true);
    }

    // 如果我们在配置文件或者启动时允许了自动确认
    const AUTO_CONFIRM = process.env.AUTO_CONFIRM === 'true'; // 默认false，需要明确设置为true才自动确认

    if (AUTO_CONFIRM) {
      console.log(`[ConfirmManager] Auto-approving action: ${actionInfo.action}`);
      return onResponse(true);
    }

    this.pendingConfirms.set(confirmId, { actionInfo, onResponse });

    // TODO: 将 confirmId 发送给 WebSocket 前端，前端弹窗后调用 /api/confirm/:id
    console.log(`[ConfirmManager] Action ${actionInfo.action} requires confirmation. ID: ${confirmId}`);

    // 超时拒绝 (3分钟)
    setTimeout(() => {
      if (this.pendingConfirms.has(confirmId)) {
        console.log(`[ConfirmManager] Confirmation timeout for ${confirmId}`);
        const { onResponse } = this.pendingConfirms.get(confirmId);
        this.pendingConfirms.delete(confirmId);
        onResponse(false);
      }
    }, 180000);
  }

  /**
   * 检查是否应该自动批准该动作
   * @param {Object} actionInfo 动作信息
   * @returns {boolean} 是否自动批准
   */
  shouldAutoApprove(actionInfo) {
    // 检查是否为进化动作
    const isEvolutionAction = this.AUTO_EVOLVE_WHITELIST.includes(actionInfo.action);

    if (!isEvolutionAction) {
      return false;
    }

    // 检查任务是否为自动进化任务
    const task = actionInfo.task;
    if (!task) {
      return false;
    }

    // 检查任务是否标记为自动进化
    if (task.autoEvolve === true) {
      return true;
    }

    // 检查任务提示是否包含自动进化标识
    if (task.prompt && task.prompt.includes(this.AUTO_EVOLVE_TASK_PREFIX)) {
      return true;
    }

    // 检查任务选项是否包含自动进化标记
    if (task.options && task.options.autoEvolve === true) {
      return true;
    }

    return false;
  }

  /**
   * 前端或者 API 响应确认结果
   */
  respondConfirm(confirmId, approved) {
    if (this.pendingConfirms.has(confirmId)) {
      const { onResponse } = this.pendingConfirms.get(confirmId);
      this.pendingConfirms.delete(confirmId);
      onResponse(approved);
      return true;
    }
    return false;
  }
}

module.exports = new ConfirmManager();
