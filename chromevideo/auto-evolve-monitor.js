// auto-evolve-monitor.js
// Chrome扩展自动进化监控模块

/**
 * 错误类型定义
 */
const ERROR_TYPES = {
  WEBSOCKET_CONNECTION: 'websocket_connection_error',
  WEBSOCKET_MESSAGE: 'websocket_message_error',
  DOM_SELECTOR: 'dom_selector_not_found',
  CONTENT_SCRIPT: 'content_script_injection_failed',
  TASK_EXECUTION: 'task_execution_failed',
  PERFORMANCE: 'task_execution_timeout',
  API_RESPONSE: 'api_response_error',
  EXTENSION_PERMISSION: 'extension_permission_error',
  PAGE_LOAD: 'page_load_timeout',
  ELEMENT_INTERACTION: 'element_interaction_failed'
};

/**
 * 监控配置
 */
const MONITOR_CONFIG = {
  // 错误触发阈值
  errorThresholds: {
    [ERROR_TYPES.WEBSOCKET_CONNECTION]: 2, // 2次连接失败触发
    [ERROR_TYPES.WEBSOCKET_MESSAGE]: 2,    // 2次消息错误触发
    [ERROR_TYPES.DOM_SELECTOR]: 3,         // 3次选择器失败触发
    [ERROR_TYPES.CONTENT_SCRIPT]: 2,       // 2次内容脚本错误触发
    [ERROR_TYPES.TASK_EXECUTION]: 2,       // 2次任务执行失败触发
    [ERROR_TYPES.PERFORMANCE]: 1,          // 1次超时触发
    [ERROR_TYPES.API_RESPONSE]: 3,         // 3次API响应错误触发
    [ERROR_TYPES.EXTENSION_PERMISSION]: 1, // 1次权限错误触发（高优先级）
    [ERROR_TYPES.PAGE_LOAD]: 2,            // 2次页面加载超时触发
    [ERROR_TYPES.ELEMENT_INTERACTION]: 3,  // 3次元素交互失败触发
    default: 3
  },

  // 性能阈值（毫秒）
  performanceThresholds: {
    taskExecution: 30000,    // 任务执行超时：30秒
    pageLoad: 10000,         // 页面加载超时：10秒
    elementFind: 5000,       // 元素查找超时：5秒
    wsReconnect: 3000        // WebSocket重连超时：3秒
  },

  // 进化频率限制
  evolutionLimits: {
    maxPerDay: 5,           // 每日最大自动进化次数
    coolingPeriod: 3600000, // 相同错误冷却期：1小时（毫秒）
    minInterval: 300000     // 最小进化间隔：5分钟（毫秒）
  },

  // 监控间隔（毫秒）
  checkInterval: 60000,      // 每60秒检查一次

  // 自动进化白名单
  autoEvolveWhitelist: [
    ERROR_TYPES.WEBSOCKET_CONNECTION,    // 连接问题（最高优先级）
    ERROR_TYPES.WEBSOCKET_MESSAGE,       // 消息处理问题
    ERROR_TYPES.DOM_SELECTOR,            // 功能失效
    ERROR_TYPES.CONTENT_SCRIPT,          // 脚本注入失败
    ERROR_TYPES.TASK_EXECUTION,          // 任务执行失败
    ERROR_TYPES.EXTENSION_PERMISSION,    // 权限问题
    ERROR_TYPES.PERFORMANCE,             // 性能问题（超时）
    ERROR_TYPES.PAGE_LOAD,               // 页面加载问题
    ERROR_TYPES.ELEMENT_INTERACTION      // 元素交互问题
  ]
};

/**
 * 自动进化监控器
 */
class AutoEvolveMonitor {
  constructor() {
    this.errorCounts = new Map();
    this.errorHistory = new Map();
    this.lastEvolveTime = new Map();
    this.dailyEvolveCount = 0;
    this.lastDailyReset = Date.now();

    // 初始化所有错误类型的计数
    Object.values(ERROR_TYPES).forEach(type => {
      this.errorCounts.set(type, 0);
      this.errorHistory.set(type, []);
    });

    console.log('[AutoEvolveMonitor] 监控器已初始化');
  }

  /**
   * 监控WebSocket连接
   * @param {WebSocket} ws WebSocket实例
   */
  monitorWebSocket(ws) {
    if (!ws) return;

    // 监控连接错误
    ws.addEventListener('error', (event) => {
      console.error('[AutoEvolveMonitor] WebSocket连接错误:', event.error);
      this.recordError(ERROR_TYPES.WEBSOCKET_CONNECTION, {
        error: event.error?.message || 'Unknown WebSocket error',
        url: ws.url,
        timestamp: new Date().toISOString()
      });
    });

    // 监控消息错误
    ws.addEventListener('messageerror', (event) => {
      console.error('[AutoEvolveMonitor] WebSocket消息错误:', event);
      this.recordError(ERROR_TYPES.WEBSOCKET_MESSAGE, {
        error: 'WebSocket message error',
        data: event.data,
        timestamp: new Date().toISOString()
      });
    });

    // 监控连接关闭
    ws.addEventListener('close', (event) => {
      if (event.code !== 1000 && event.code !== 1001) { // 正常关闭和端点离开除外
        console.warn('[AutoEvolveMonitor] WebSocket异常关闭:', event.code, event.reason);
        this.recordError(ERROR_TYPES.WEBSOCKET_CONNECTION, {
          error: `WebSocket closed with code ${event.code}: ${event.reason}`,
          code: event.code,
          reason: event.reason,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  /**
   * 监控任务执行性能
   * @param {string} taskId 任务ID
   * @param {number} startTime 开始时间（时间戳）
   */
  monitorTaskPerformance(taskId, startTime) {
    const duration = Date.now() - startTime;
    if (duration > MONITOR_CONFIG.performanceThresholds.taskExecution) {
      console.warn(`[AutoEvolveMonitor] 任务执行超时: ${taskId}, 耗时: ${duration}ms`);
      this.recordError(ERROR_TYPES.PERFORMANCE, {
        taskId,
        duration,
        threshold: MONITOR_CONFIG.performanceThresholds.taskExecution,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 记录DOM选择器错误
   * @param {string} selector 选择器
   * @param {string} context 上下文描述
   */
  recordDomSelectorError(selector, context) {
    console.warn(`[AutoEvolveMonitor] DOM选择器失败: ${selector} (${context})`);
    this.recordError(ERROR_TYPES.DOM_SELECTOR, {
      selector,
      context,
      timestamp: new Date().toISOString(),
      url: window.location.href
    });
  }

  /**
   * 记录内容脚本错误
   * @param {string} error 错误信息
   * @param {object} details 详细错误信息
   */
  recordContentScriptError(error, details = {}) {
    console.error('[AutoEvolveMonitor] 内容脚本错误:', error, details);
    this.recordError(ERROR_TYPES.CONTENT_SCRIPT, {
      error,
      ...details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 记录任务执行错误
   * @param {string} taskId 任务ID
   * @param {string} error 错误信息
   * @param {object} details 详细错误信息
   */
  recordTaskExecutionError(taskId, error, details = {}) {
    console.error(`[AutoEvolveMonitor] 任务执行失败: ${taskId}`, error, details);
    this.recordError(ERROR_TYPES.TASK_EXECUTION, {
      taskId,
      error,
      ...details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 记录API响应错误
   * @param {string} url API URL
   * @param {number} status HTTP状态码
   * @param {string} response 响应内容
   */
  recordApiResponseError(url, status, response) {
    console.error(`[AutoEvolveMonitor] API响应错误: ${url} (${status})`);
    this.recordError(ERROR_TYPES.API_RESPONSE, {
      url,
      status,
      response: response?.substring(0, 200), // 限制响应长度
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 记录错误并检查是否触发自动进化
   * @param {string} errorType 错误类型
   * @param {object} details 错误详细信息
   */
  recordError(errorType, details) {
    // 检查是否为有效错误类型
    if (!Object.values(ERROR_TYPES).includes(errorType)) {
      console.warn(`[AutoEvolveMonitor] 未知错误类型: ${errorType}`);
      return;
    }

    // 更新错误计数
    const currentCount = this.errorCounts.get(errorType) || 0;
    const newCount = currentCount + 1;
    this.errorCounts.set(errorType, newCount);

    // 记录错误历史
    const history = this.errorHistory.get(errorType) || [];
    history.push({
      ...details,
      count: newCount,
      recordedAt: new Date().toISOString()
    });

    // 保持历史记录大小
    if (history.length > 10) {
      history.shift();
    }
    this.errorHistory.set(errorType, history);

    console.log(`[AutoEvolveMonitor] 记录错误: ${errorType}, 计数: ${newCount}`);

    // 检查是否触发自动进化
    this.checkAutoEvolve(errorType, details);
  }

  /**
   * 检查是否触发自动进化
   * @param {string} errorType 错误类型
   * @param {object} details 错误详细信息
   */
  checkAutoEvolve(errorType, details) {
    // 检查是否在白名单中
    if (!MONITOR_CONFIG.autoEvolveWhitelist.includes(errorType)) {
      return;
    }

    // 检查冷却期
    const lastEvolve = this.lastEvolveTime.get(errorType);
    if (lastEvolve && (Date.now() - lastEvolve < MONITOR_CONFIG.evolutionLimits.coolingPeriod)) {
      console.log(`[AutoEvolveMonitor] 错误类型 ${errorType} 处于冷却期`);
      return;
    }

    // 检查最小间隔
    const lastEvolveValues = Array.from(this.lastEvolveTime.values()).filter(t => t);
    const lastAnyEvolve = lastEvolveValues.length > 0 ? Math.max(...lastEvolveValues) : 0;
    if (lastAnyEvolve && (Date.now() - lastAnyEvolve < MONITOR_CONFIG.evolutionLimits.minInterval)) {
      console.log(`[AutoEvolveMonitor] 进化间隔太短`);
      return;
    }

    // 检查每日限制
    this.resetDailyCountIfNeeded();
    if (this.dailyEvolveCount >= MONITOR_CONFIG.evolutionLimits.maxPerDay) {
      console.warn(`[AutoEvolveMonitor] 达到每日最大进化次数: ${this.dailyEvolveCount}`);
      return;
    }

    // 检查错误阈值
    const threshold = MONITOR_CONFIG.errorThresholds[errorType] || MONITOR_CONFIG.errorThresholds.default;
    const errorCount = this.errorCounts.get(errorType) || 0;

    if (errorCount >= threshold) {
      console.log(`[AutoEvolveMonitor] 触发自动进化: ${errorType} (计数: ${errorCount}, 阈值: ${threshold})`);
      this.triggerAutoEvolve(errorType, details);
    }
  }

  /**
   * 触发自动进化
   * @param {string} errorType 错误类型
   * @param {object} details 错误详细信息
   */
  triggerAutoEvolve(errorType, details) {
    // 更新进化时间
    this.lastEvolveTime.set(errorType, Date.now());
    this.dailyEvolveCount++;

    // 构建进化请求
    const evolutionRequest = {
      type: 'auto_evolve',
      errorType: errorType,
      errorMessage: details.error || `Error of type: ${errorType}`,
      location: details.context || details.url || 'unknown',
      currentCode: details.selector || details.url || 'unknown',
      timestamp: new Date().toISOString(),
      errorCount: this.errorCounts.get(errorType) || 0,
      details: {
        ...details,
        // 移除可能过大的数据
        response: details.response ? details.response.substring(0, 500) : undefined
      }
    };

    console.log('[AutoEvolveMonitor] 发送自动进化请求:', evolutionRequest);

    // 通过chrome.runtime发送消息到offscreen
    try {
      chrome.runtime.sendMessage(evolutionRequest, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AutoEvolveMonitor] 发送消息失败:', chrome.runtime.lastError.message);
          return;
        }

        console.log('[AutoEvolveMonitor] 自动进化请求已发送');

        // 重置该错误类型的计数
        this.errorCounts.set(errorType, 0);
        this.errorHistory.set(errorType, []);
      });
    } catch (error) {
      console.error('[AutoEvolveMonitor] 发送消息异常:', error);
    }
  }

  /**
   * 如果需要，重置每日计数
   */
  resetDailyCountIfNeeded() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000; // 24小时

    if (now - this.lastDailyReset >= oneDay) {
      this.dailyEvolveCount = 0;
      this.lastDailyReset = now;
      console.log('[AutoEvolveMonitor] 每日进化计数已重置');
    }
  }

  /**
   * 获取监控统计
   * @returns {object} 监控统计信息
   */
  getStats() {
    const stats = {};

    for (const [errorType, count] of this.errorCounts) {
      stats[errorType] = {
        count,
        lastEvolve: this.lastEvolveTime.get(errorType),
        historyLength: (this.errorHistory.get(errorType) || []).length
      };
    }

    return {
      errorCounts: stats,
      dailyEvolveCount: this.dailyEvolveCount,
      lastDailyReset: this.lastDailyReset,
      config: MONITOR_CONFIG
    };
  }

  /**
   * 重置监控器
   */
  reset() {
    Object.values(ERROR_TYPES).forEach(type => {
      this.errorCounts.set(type, 0);
      this.errorHistory.set(type, []);
    });
    this.lastEvolveTime.clear();
    this.dailyEvolveCount = 0;
    this.lastDailyReset = Date.now();
    console.log('[AutoEvolveMonitor] 监控器已重置');
  }
}

// 创建全局实例
const autoEvolveMonitor = new AutoEvolveMonitor();

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AutoEvolveMonitor,
    ERROR_TYPES,
    MONITOR_CONFIG,
    autoEvolveMonitor
  };
}

// 在浏览器环境中全局可用
if (typeof window !== 'undefined') {
  window.AutoEvolveMonitor = AutoEvolveMonitor;
  window.ERROR_TYPES = ERROR_TYPES;
  window.MONITOR_CONFIG = MONITOR_CONFIG;
  window.autoEvolveMonitor = autoEvolveMonitor;
}

console.log('[AutoEvolveMonitor] 模块加载完成');