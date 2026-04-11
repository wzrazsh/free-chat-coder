/**
 * 自动进化策略管理器
 * 负责管理进化频率、优先级、风险评估和效果跟踪
 */

const path = require('path');
const fs = require('fs');

/**
 * 进化策略配置
 */
const EVOLUTION_STRATEGY_CONFIG = {
  // 进化频率限制
  frequencyLimits: {
    maxPerHour: 3,           // 每小时最大进化次数
    maxPerDay: 10,           // 每天最大进化次数
    coolingPeriod: 3600000,  // 相同错误冷却期：1小时（毫秒）
    minInterval: 300000      // 最小进化间隔：5分钟（毫秒）
  },

  // 错误类型优先级映射（0最高，9最低）
  errorPriorityMap: {
    websocket_connection_error: 0,  // 最高优先级：连接问题
    websocket_message_error: 1,     // 高优先级：消息处理问题
    dom_selector_not_found: 1,      // 高优先级：功能失效
    task_execution_failed: 1,       // 高优先级：任务失败
    content_script_injection_failed: 2, // 中高优先级：脚本注入失败
    extension_permission_error: 2,  // 中高优先级：权限问题
    task_execution_timeout: 3,      // 中优先级：性能问题
    page_load_timeout: 3,           // 中优先级：页面加载问题
    element_interaction_failed: 3,  // 中优先级：元素交互问题
    api_response_error: 4,          // 中低优先级：API问题
    default: 5                      // 默认优先级
  },

  // 风险评估配置
  riskAssessment: {
    highRiskActions: ['evolve_extension', 'evolve_handler', 'evolve_server'],
    safeFileExtensions: ['.js', '.json', '.html', '.css'],
    restrictedPaths: [
      'node_modules',
      '.git',
      'package-lock.json',
      'yarn.lock'
    ]
  },

  // 进化效果跟踪
  effectTracking: {
    trackingWindow: 86400000, // 24小时跟踪窗口
    successThreshold: 0.7,    // 成功率阈值：70%
    minSamples: 3             // 最小样本数
  }
};

/**
 * 进化策略管理器
 */
class AutoEvolveManager {
  constructor() {
    this.evolutionHistory = new Map();
    this.errorEvolutionStats = new Map();
    this.evolutionSuccessRates = new Map();
    this.lastEvolutionTime = 0;
    this.dailyEvolutionCount = 0;
    this.lastDailyReset = Date.now();

    console.log('[AutoEvolveManager] 策略管理器已初始化');
  }

  /**
   * 检查是否允许自动进化
   * @param {string} errorType 错误类型
   * @param {object} evolutionData 进化数据
   * @returns {object} 检查结果 { allowed: boolean, reason?: string, priority?: number }
   */
  shouldAllowEvolution(errorType, evolutionData) {
    const now = Date.now();

    // 重置每日计数
    this.resetDailyCountIfNeeded();

    // 检查每日限制
    if (this.dailyEvolutionCount >= EVOLUTION_STRATEGY_CONFIG.frequencyLimits.maxPerDay) {
      return {
        allowed: false,
        reason: `达到每日最大进化次数: ${this.dailyEvolutionCount}/${EVOLUTION_STRATEGY_CONFIG.frequencyLimits.maxPerDay}`,
        priority: this.getErrorPriority(errorType)
      };
    }

    // 检查每小时限制
    const hourAgo = now - 3600000;
    const recentEvolves = Array.from(this.evolutionHistory.values())
      .filter(req => req.timestamp > hourAgo);

    if (recentEvolves.length >= EVOLUTION_STRATEGY_CONFIG.frequencyLimits.maxPerHour) {
      return {
        allowed: false,
        reason: `达到每小时最大进化次数: ${recentEvolves.length}/${EVOLUTION_STRATEGY_CONFIG.frequencyLimits.maxPerHour}`,
        priority: this.getErrorPriority(errorType)
      };
    }

    // 检查相同错误冷却期
    const sameErrorEvolves = recentEvolves.filter(req => req.errorType === errorType);
    if (sameErrorEvolves.length > 0) {
      return {
        allowed: false,
        reason: `相同错误类型 ${errorType} 处于冷却期`,
        priority: this.getErrorPriority(errorType)
      };
    }

    // 检查最小间隔
    if (this.lastEvolutionTime &&
        (now - this.lastEvolutionTime < EVOLUTION_STRATEGY_CONFIG.frequencyLimits.minInterval)) {
      return {
        allowed: false,
        reason: `进化间隔太短: ${now - this.lastEvolutionTime}ms`,
        priority: this.getErrorPriority(errorType)
      };
    }

    // 检查进化成功率（如果历史数据足够）
    const successRate = this.getEvolutionSuccessRate(errorType);
    if (successRate !== null && successRate < EVOLUTION_STRATEGY_CONFIG.effectTracking.successThreshold) {
      return {
        allowed: false,
        reason: `该错误类型的进化成功率过低: ${(successRate * 100).toFixed(1)}%`,
        priority: this.getErrorPriority(errorType),
        successRate
      };
    }

    // 风险评估
    const riskLevel = this.assessEvolutionRisk(evolutionData);
    if (riskLevel === 'high') {
      return {
        allowed: false,
        reason: '风险评估过高，需要人工确认',
        priority: this.getErrorPriority(errorType),
        riskLevel
      };
    }

    return {
      allowed: true,
      priority: this.getErrorPriority(errorType),
      riskLevel
    };
  }

  /**
   * 获取错误类型优先级
   * @param {string} errorType 错误类型
   * @returns {number} 优先级（0-9，0最高）
   */
  getErrorPriority(errorType) {
    return EVOLUTION_STRATEGY_CONFIG.errorPriorityMap[errorType] ||
           EVOLUTION_STRATEGY_CONFIG.errorPriorityMap.default;
  }

  /**
   * 评估进化风险
   * @param {object} evolutionData 进化数据
   * @returns {string} 风险等级：'low', 'medium', 'high'
   */
  assessEvolutionRisk(evolutionData) {
    const { errorType, details = {} } = evolutionData;

    // 高风险错误类型
    const highRiskErrorTypes = [
      'extension_permission_error',
      'content_script_injection_failed'
    ];

    if (highRiskErrorTypes.includes(errorType)) {
      return 'high';
    }

    // 检查是否涉及高风险文件
    if (details.filePath) {
      const fileName = path.basename(details.filePath);
      const fileExt = path.extname(details.filePath);

      // 检查文件扩展名
      if (!EVOLUTION_STRATEGY_CONFIG.riskAssessment.safeFileExtensions.includes(fileExt)) {
        return 'high';
      }

      // 检查限制路径
      for (const restrictedPath of EVOLUTION_STRATEGY_CONFIG.riskAssessment.restrictedPaths) {
        if (details.filePath.includes(restrictedPath)) {
          return 'high';
        }
      }

      // 关键系统文件
      const criticalFiles = [
        'manifest.json',
        'background.js',
        'offscreen.js',
        'custom-handler.js'
      ];

      if (criticalFiles.includes(fileName)) {
        return 'medium';
      }
    }

    return 'low';
  }

  /**
   * 记录进化请求
   * @param {object} evolutionData 进化数据
   * @returns {string} 记录ID
   */
  recordEvolutionRequest(evolutionData) {
    const requestId = `evolve-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const record = {
      id: requestId,
      errorType: evolutionData.errorType,
      errorMessage: evolutionData.errorMessage,
      location: evolutionData.location,
      priority: this.getErrorPriority(evolutionData.errorType),
      riskLevel: this.assessEvolutionRisk(evolutionData),
      timestamp: evolutionData.timestamp || Date.now(),
      recordedAt: new Date().toISOString(),
      details: evolutionData.details || {}
    };

    this.evolutionHistory.set(requestId, record);
    this.lastEvolutionTime = Date.now();
    this.dailyEvolutionCount++;

    // 清理旧记录（保留最近100条）
    if (this.evolutionHistory.size > 100) {
      const keys = Array.from(this.evolutionHistory.keys());
      const oldestKey = keys.reduce((oldest, key) => {
        return this.evolutionHistory.get(key).timestamp < this.evolutionHistory.get(oldest).timestamp ? key : oldest;
      });
      this.evolutionHistory.delete(oldestKey);
    }

    console.log(`[AutoEvolveManager] 记录进化请求: ${requestId} for ${evolutionData.errorType}`);
    return requestId;
  }

  /**
   * 记录进化结果
   * @param {string} requestId 请求ID
   * @param {boolean} success 是否成功
   * @param {object} result 结果详情
   */
  recordEvolutionResult(requestId, success, result = {}) {
    if (!this.evolutionHistory.has(requestId)) {
      console.warn(`[AutoEvolveManager] 未找到进化请求: ${requestId}`);
      return;
    }

    const record = this.evolutionHistory.get(requestId);
    record.completedAt = new Date().toISOString();
    record.success = success;
    record.result = result;

    // 更新错误类型统计
    const errorType = record.errorType;
    if (!this.errorEvolutionStats.has(errorType)) {
      this.errorEvolutionStats.set(errorType, { total: 0, successful: 0 });
    }

    const stats = this.errorEvolutionStats.get(errorType);
    stats.total++;
    if (success) {
      stats.successful++;
    }

    // 计算成功率
    const successRate = stats.successful / stats.total;
    this.evolutionSuccessRates.set(errorType, successRate);

    console.log(`[AutoEvolveManager] 记录进化结果: ${requestId}, 成功: ${success}, 成功率: ${(successRate * 100).toFixed(1)}%`);
  }

  /**
   * 获取进化成功率
   * @param {string} errorType 错误类型
   * @returns {number|null} 成功率（0-1），如果样本不足返回null
   */
  getEvolutionSuccessRate(errorType) {
    if (!this.errorEvolutionStats.has(errorType)) {
      return null;
    }

    const stats = this.errorEvolutionStats.get(errorType);
    if (stats.total < EVOLUTION_STRATEGY_CONFIG.effectTracking.minSamples) {
      return null;
    }

    return stats.successful / stats.total;
  }

  /**
   * 获取进化统计信息
   * @returns {object} 统计信息
   */
  getEvolutionStats() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    const history = Array.from(this.evolutionHistory.values());

    const stats = {
      total: history.length,
      lastHour: history.filter(req => req.timestamp > hourAgo).length,
      lastDay: history.filter(req => req.timestamp > dayAgo).length,
      dailyCount: this.dailyEvolutionCount,
      byErrorType: {},
      byPriority: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      byRiskLevel: { low: 0, medium: 0, high: 0 },
      recentRequests: history.slice(-10).map(req => ({
        id: req.id,
        errorType: req.errorType,
        priority: req.priority,
        riskLevel: req.riskLevel,
        success: req.success,
        timestamp: new Date(req.timestamp).toISOString()
      })),
      successRates: {}
    };

    // 按错误类型统计
    history.forEach(req => {
      stats.byErrorType[req.errorType] = (stats.byErrorType[req.errorType] || 0) + 1;
      stats.byPriority[req.priority] = (stats.byPriority[req.priority] || 0) + 1;
      stats.byRiskLevel[req.riskLevel] = (stats.byRiskLevel[req.riskLevel] || 0) + 1;
    });

    // 成功率统计
    for (const [errorType, successRate] of this.evolutionSuccessRates) {
      stats.successRates[errorType] = successRate;
    }

    return stats;
  }

  /**
   * 获取进化建议
   * @param {string} errorType 错误类型
   * @param {object} details 错误详情
   * @returns {object} 进化建议
   */
  getEvolutionAdvice(errorType, details = {}) {
    const adviceTemplates = {
      websocket_connection_error: {
        suggestedActions: ['evolve_extension', 'evolve_handler'],
        focusAreas: ['WebSocket连接逻辑', '重连机制', '错误处理'],
        riskLevel: 'medium',
        estimatedEffort: '中等'
      },
      dom_selector_not_found: {
        suggestedActions: ['evolve_extension'],
        focusAreas: ['DOM选择器', '元素查找逻辑', '备用选择器'],
        riskLevel: 'low',
        estimatedEffort: '低'
      },
      task_execution_failed: {
        suggestedActions: ['evolve_extension', 'evolve_handler'],
        focusAreas: ['任务执行流程', '错误处理', '重试机制'],
        riskLevel: 'medium',
        estimatedEffort: '中等'
      },
      content_script_injection_failed: {
        suggestedActions: ['evolve_extension'],
        focusAreas: ['manifest.json配置', '内容脚本注入', '权限设置'],
        riskLevel: 'high',
        estimatedEffort: '高'
      },
      default: {
        suggestedActions: ['evolve_extension', 'evolve_handler'],
        focusAreas: ['错误处理', '代码逻辑'],
        riskLevel: 'medium',
        estimatedEffort: '中等'
      }
    };

    const template = adviceTemplates[errorType] || adviceTemplates.default;

    // 根据历史成功率调整建议
    const successRate = this.getEvolutionSuccessRate(errorType);
    if (successRate !== null && successRate < 0.5) {
      template.riskLevel = 'high';
      template.estimatedEffort = '高';
    }

    return template;
  }

  /**
   * 如果需要，重置每日计数
   */
  resetDailyCountIfNeeded() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000; // 24小时

    if (now - this.lastDailyReset >= oneDay) {
      this.dailyEvolutionCount = 0;
      this.lastDailyReset = now;
      console.log('[AutoEvolveManager] 每日进化计数已重置');
    }
  }

  /**
   * 重置管理器
   */
  reset() {
    this.evolutionHistory.clear();
    this.errorEvolutionStats.clear();
    this.evolutionSuccessRates.clear();
    this.lastEvolutionTime = 0;
    this.dailyEvolutionCount = 0;
    this.lastDailyReset = Date.now();
    console.log('[AutoEvolveManager] 管理器已重置');
  }
}

// 创建单例实例
const autoEvolveManager = new AutoEvolveManager();

module.exports = {
  AutoEvolveManager,
  EVOLUTION_STRATEGY_CONFIG,
  autoEvolveManager
};