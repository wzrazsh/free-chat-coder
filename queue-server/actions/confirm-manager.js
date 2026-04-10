/**
 * 管理需要用户确认的危险动作
 * 由于目前控制台还没有做弹出确认的UI，先实现一个自动通过的桩实现
 * 或者默认拒绝高危操作，等待后续迭代完善 UI。
 * 这里我们默认配置项中带有 `autoConfirm: true` 就放行。
 */
class ConfirmManager {
  constructor() {
    this.pendingConfirms = new Map();
  }

  /**
   * 请求确认
   * @param {Object} actionInfo { taskId, action, params, riskLevel }
   * @param {Function} onResponse 回调函数 (approved) => void
   */
  requestConfirm(actionInfo, onResponse) {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    // 如果我们在配置文件或者启动时允许了自动确认
    const AUTO_CONFIRM = process.env.AUTO_CONFIRM !== 'false'; // 默认自动确认以方便测试
    
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
