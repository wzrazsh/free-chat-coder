/**
 * 自我诊断模块
 * 负责分析错误类型和根本原因，生成结构化问题报告
 */

const path = require('path');

/**
 * 错误分析配置
 */
const DIAGNOSIS_CONFIG = {
  // 错误类型到根本原因的映射
  errorRootCauseMap: {
    websocket_connection_error: [
      '网络连接问题',
      '服务器未运行',
      '端口被占用',
      '防火墙限制',
      'WebSocket地址错误'
    ],
    websocket_message_error: [
      '消息格式错误',
      '编码问题',
      '数据解析失败',
      '消息大小超限'
    ],
    dom_selector_not_found: [
      '页面结构变化',
      '选择器过时',
      '元素加载延迟',
      'iframe嵌套问题',
      '动态内容未加载'
    ],
    content_script_injection_failed: [
      '权限不足',
      '内容安全策略限制',
      '脚本加载时机问题',
      '页面URL不匹配',
      'manifest.json配置错误'
    ],
    task_execution_failed: [
      '任务参数错误',
      '环境依赖缺失',
      '资源限制',
      '并发冲突',
      '外部服务不可用'
    ],
    task_execution_timeout: [
      '性能瓶颈',
      '资源竞争',
      '网络延迟',
      '外部API响应慢',
      '死锁或无限循环'
    ],
    api_response_error: [
      'API端点变更',
      '认证失败',
      '参数验证失败',
      '服务器错误',
      '网络超时'
    ],
    extension_permission_error: [
      '权限声明缺失',
      '权限请求被拒绝',
      '权限作用域不足',
      'manifest版本不兼容'
    ],
    page_load_timeout: [
      '网络连接慢',
      '页面资源过大',
      'DNS解析问题',
      '服务器响应慢',
      'CDN问题'
    ],
    element_interaction_failed: [
      '元素状态不可交互',
      '事件监听器冲突',
      '页面框架冲突',
      '异步操作未完成'
    ]
  },

  // 严重程度评估标准
  severityCriteria: {
    impact: {
      high: ['功能完全失效', '系统崩溃', '数据丢失'],
      medium: ['功能降级', '性能下降', '用户体验差'],
      low: ['轻微错误', '不影响核心功能', '可自动恢复']
    },
    scope: {
      high: ['全局影响', '所有用户'],
      medium: ['部分功能', '特定用户群'],
      low: ['边缘功能', '个别用户']
    },
    frequency: {
      high: ['持续发生', '频繁出现'],
      medium: ['偶尔发生', '可预测'],
      low: ['罕见', '一次性']
    }
  },

  // 修复建议模板
  fixSuggestionTemplates: {
    websocket_connection_error: {
      immediateActions: ['检查服务器状态', '验证网络连接', '检查防火墙设置'],
      codeFixes: ['优化重连逻辑', '添加连接超时', '实现心跳机制'],
      testingStrategies: ['模拟网络中断', '测试重连场景', '验证错误恢复']
    },
    dom_selector_not_found: {
      immediateActions: ['手动验证选择器', '检查页面结构', '查看控制台错误'],
      codeFixes: ['更新选择器', '添加备用选择器', '实现元素等待机制'],
      testingStrategies: ['测试不同页面状态', '验证元素查找', '模拟页面变化']
    },
    task_execution_failed: {
      immediateActions: ['查看任务日志', '检查参数格式', '验证依赖状态'],
      codeFixes: ['增强错误处理', '添加任务重试', '优化资源管理'],
      testingStrategies: ['测试边界条件', '模拟失败场景', '验证恢复流程']
    },
    default: {
      immediateActions: ['查看错误日志', '分析错误上下文', '验证系统状态'],
      codeFixes: ['增强错误处理', '添加日志记录', '优化代码逻辑'],
      testingStrategies: ['单元测试', '集成测试', '错误场景测试']
    }
  }
};

/**
 * 自我诊断分析器
 */
class SelfDiagnosis {
  constructor() {
    console.log('[SelfDiagnosis] 诊断分析器已初始化');
  }

  /**
   * 分析错误并生成诊断报告
   * @param {object} errorData 错误数据
   * @returns {object} 诊断报告
   */
  analyzeError(errorData) {
    const { errorType, errorMessage, location, details = {} } = errorData;
    const timestamp = new Date().toISOString();

    console.log(`[SelfDiagnosis] 分析错误: ${errorType}`);

    // 分析根本原因
    const rootCauses = this.analyzeRootCauses(errorType, details);

    // 评估严重程度
    const severity = this.assessSeverity(errorType, details);

    // 生成修复建议
    const suggestions = this.generateSuggestions(errorType, details);

    // 生成诊断报告
    const report = {
      errorId: `diagnosis-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      errorType,
      errorMessage,
      location,
      timestamp,
      details,
      analysis: {
        rootCauses,
        mostLikelyCause: rootCauses.length > 0 ? rootCauses[0] : '未知原因',
        confidence: this.calculateConfidence(errorType, details),
        patterns: this.identifyPatterns(errorType, details)
      },
      severity,
      impact: {
        functional: severity.functional,
        performance: severity.performance,
        userExperience: severity.userExperience,
        systemStability: severity.systemStability
      },
      suggestions,
      recommendations: this.generateRecommendations(errorType, severity, suggestions),
      metadata: {
        analyzedAt: timestamp,
        analysisVersion: '1.0',
        dataSources: Object.keys(details)
      }
    };

    console.log(`[SelfDiagnosis] 诊断报告生成完成: ${report.errorId}`);
    return report;
  }

  /**
   * 分析根本原因
   * @param {string} errorType 错误类型
   * @param {object} details 错误详情
   * @returns {string[]} 可能的原因列表
   */
  analyzeRootCauses(errorType, details) {
    const possibleCauses = DIAGNOSIS_CONFIG.errorRootCauseMap[errorType] ||
                          ['未知系统错误', '代码逻辑问题', '环境配置问题'];

    // 根据详情调整原因优先级
    const contextualCauses = this.applyContextToCauses(possibleCauses, details);

    // 添加基于详情的特定原因
    const specificCauses = this.extractSpecificCauses(details);
    const allCauses = [...contextualCauses, ...specificCauses];

    // 去重并限制数量
    const uniqueCauses = [...new Set(allCauses)];
    return uniqueCauses.slice(0, 5); // 返回最多5个可能原因
  }

  /**
   * 根据上下文调整原因优先级
   */
  applyContextToCauses(causes, details) {
    const contextualCauses = [...causes];

    // 根据错误详情调整优先级
    if (details.url && details.url.includes('localhost')) {
      // 本地环境相关原因
      const localCauses = ['本地服务器未启动', '端口冲突', '开发环境配置问题'];
      contextualCauses.unshift(...localCauses);
    }

    if (details.selector) {
      // DOM选择器相关原因
      const selectorCauses = ['选择器语法错误', '元素尚未加载', '页面结构变更'];
      contextualCauses.unshift(...selectorCauses);
    }

    if (details.statusCode) {
      // HTTP状态码相关原因
      const statusCauses = this.getStatusBasedCauses(details.statusCode);
      contextualCauses.unshift(...statusCauses);
    }

    return contextualCauses;
  }

  /**
   * 根据HTTP状态码获取原因
   */
  getStatusBasedCauses(statusCode) {
    const statusMap = {
      400: ['请求参数错误', '格式验证失败'],
      401: ['认证失败', '令牌过期'],
      403: ['权限不足', '访问被拒绝'],
      404: ['资源不存在', 'API端点错误'],
      500: ['服务器内部错误', '代码执行异常'],
      502: ['网关错误', '上游服务不可用'],
      503: ['服务不可用', '维护中'],
      504: ['网关超时', '上游服务响应慢']
    };

    return statusMap[statusCode] || ['HTTP错误', '网络通信问题'];
  }

  /**
   * 从详情中提取特定原因
   */
  extractSpecificCauses(details) {
    const specificCauses = [];

    if (details.error && typeof details.error === 'string') {
      const errorLower = details.error.toLowerCase();

      if (errorLower.includes('timeout')) {
        specificCauses.push('操作超时');
      }
      if (errorLower.includes('permission')) {
        specificCauses.push('权限问题');
      }
      if (errorLower.includes('network')) {
        specificCauses.push('网络问题');
      }
      if (errorLower.includes('syntax')) {
        specificCauses.push('语法错误');
      }
      if (errorLower.includes('undefined')) {
        specificCauses.push('变量未定义');
      }
      if (errorLower.includes('null')) {
        specificCauses.push('空值引用');
      }
    }

    return specificCauses;
  }

  /**
   * 评估严重程度
   */
  assessSeverity(errorType, details) {
    // 基础严重程度
    const baseSeverity = this.getBaseSeverity(errorType);

    // 根据详情调整
    const adjustedSeverity = this.adjustSeverity(baseSeverity, details);

    // 计算综合分数
    const score = this.calculateSeverityScore(adjustedSeverity);

    return {
      ...adjustedSeverity,
      score,
      level: this.getSeverityLevel(score)
    };
  }

  /**
   * 获取基础严重程度
   */
  getBaseSeverity(errorType) {
    const severityMap = {
      websocket_connection_error: {
        functional: 'high',
        performance: 'medium',
        userExperience: 'high',
        systemStability: 'high'
      },
      dom_selector_not_found: {
        functional: 'high',
        performance: 'low',
        userExperience: 'medium',
        systemStability: 'low'
      },
      task_execution_failed: {
        functional: 'high',
        performance: 'medium',
        userExperience: 'medium',
        systemStability: 'medium'
      },
      content_script_injection_failed: {
        functional: 'high',
        performance: 'low',
        userExperience: 'high',
        systemStability: 'low'
      },
      extension_permission_error: {
        functional: 'high',
        performance: 'low',
        userExperience: 'high',
        systemStability: 'low'
      },
      default: {
        functional: 'medium',
        performance: 'low',
        userExperience: 'medium',
        systemStability: 'low'
      }
    };

    return severityMap[errorType] || severityMap.default;
  }

  /**
   * 根据详情调整严重程度
   */
  adjustSeverity(baseSeverity, details) {
    const adjusted = { ...baseSeverity };

    // 根据错误频率调整
    if (details.frequency === 'high' || details.count > 5) {
      adjusted.systemStability = this.escalateSeverity(adjusted.systemStability);
    }

    // 根据影响范围调整
    if (details.scope === 'global' || details.affectedUsers > 10) {
      adjusted.userExperience = this.escalateSeverity(adjusted.userExperience);
    }

    // 根据持续时间调整
    if (details.duration > 30000) { // 30秒以上
      adjusted.performance = this.escalateSeverity(adjusted.performance);
    }

    return adjusted;
  }

  /**
   * 提升严重程度等级
   */
  escalateSeverity(level) {
    const levels = ['low', 'medium', 'high'];
    const currentIndex = levels.indexOf(level);
    return currentIndex < levels.length - 1 ? levels[currentIndex + 1] : level;
  }

  /**
   * 计算严重程度分数
   */
  calculateSeverityScore(severity) {
    const scoreMap = { low: 1, medium: 2, high: 3 };
    const weights = {
      functional: 0.4,
      systemStability: 0.3,
      userExperience: 0.2,
      performance: 0.1
    };

    let totalScore = 0;
    for (const [aspect, level] of Object.entries(severity)) {
      totalScore += scoreMap[level] * (weights[aspect] || 0.1);
    }

    return totalScore;
  }

  /**
   * 获取严重程度等级
   */
  getSeverityLevel(score) {
    if (score >= 2.5) return 'critical';
    if (score >= 2.0) return 'high';
    if (score >= 1.5) return 'medium';
    return 'low';
  }

  /**
   * 计算分析置信度
   */
  calculateConfidence(errorType, details) {
    let confidence = 0.7; // 基础置信度

    // 错误类型明确
    if (errorType && errorType !== 'default') {
      confidence += 0.1;
    }

    // 有详细错误信息
    if (details.error && details.error.length > 10) {
      confidence += 0.1;
    }

    // 有上下文信息
    if (details.context || details.url || details.selector) {
      confidence += 0.1;
    }

    // 有历史数据
    if (details.history && details.history.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95); // 上限95%
  }

  /**
   * 识别错误模式
   */
  identifyPatterns(errorType, details) {
    const patterns = [];

    // 时间模式
    if (details.timestamp) {
      const hour = new Date(details.timestamp).getHours();
      if (hour >= 0 && hour < 6) {
        patterns.push('夜间发生');
      }
    }

    // 频率模式
    if (details.count > 3) {
      patterns.push('重复发生');
    }

    // 关联模式
    if (details.relatedErrors && details.relatedErrors.length > 0) {
      patterns.push('关联错误');
    }

    // 环境模式
    if (details.environment) {
      patterns.push(`环境相关: ${details.environment}`);
    }

    return patterns;
  }

  /**
   * 生成修复建议
   */
  generateSuggestions(errorType, details) {
    const template = DIAGNOSIS_CONFIG.fixSuggestionTemplates[errorType] ||
                    DIAGNOSIS_CONFIG.fixSuggestionTemplates.default;

    const suggestions = {
      immediate: [...template.immediateActions],
      shortTerm: [...template.codeFixes],
      longTerm: [...template.testingStrategies]
    };

    // 添加基于详情的特定建议
    if (details.selector) {
      suggestions.immediate.push(`检查选择器: ${details.selector}`);
      suggestions.shortTerm.push(`更新选择器或添加备用选择器`);
    }

    if (details.url) {
      suggestions.immediate.push(`访问URL验证: ${details.url}`);
    }

    if (details.error && details.error.includes('timeout')) {
      suggestions.shortTerm.push('增加超时时间或优化性能');
    }

    return suggestions;
  }

  /**
   * 生成推荐行动
   */
  generateRecommendations(errorType, severity, suggestions) {
    const recommendations = [];

    // 根据严重程度推荐
    if (severity.level === 'critical' || severity.level === 'high') {
      recommendations.push({
        priority: 'P0',
        action: '立即修复',
        timeline: '24小时内',
        resources: ['核心开发人员', '系统管理员'],
        description: '高优先级错误，需要立即关注和修复'
      });
    } else {
      recommendations.push({
        priority: 'P1',
        action: '计划修复',
        timeline: '下一迭代',
        resources: ['开发团队'],
        description: '中等优先级错误，建议在下一迭代中修复'
      });
    }

    // 根据错误类型推荐
    if (errorType === 'websocket_connection_error') {
      recommendations.push({
        priority: 'P1',
        action: '监控连接状态',
        timeline: '持续',
        resources: ['监控系统'],
        description: '建立WebSocket连接监控和告警机制'
      });
    }

    if (errorType === 'dom_selector_not_found') {
      recommendations.push({
        priority: 'P2',
        action: '建立选择器测试',
        timeline: '1周内',
        resources: ['测试团队'],
        description: '创建DOM选择器测试套件，防止类似问题'
      });
    }

    return recommendations;
  }

  /**
   * 生成诊断摘要
   */
  generateSummary(report) {
    return {
      summary: `错误诊断: ${report.errorType}`,
      keyFindings: [
        `主要可能原因: ${report.analysis.mostLikelyCause}`,
        `严重程度: ${report.severity.level} (得分: ${report.severity.score.toFixed(2)})`,
        `置信度: ${(report.analysis.confidence * 100).toFixed(1)}%`,
        `影响范围: ${Object.entries(report.impact)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')}`
      ],
      topRecommendation: report.recommendations[0]?.action || '分析并修复',
      nextSteps: report.suggestions.immediate.slice(0, 3)
    };
  }
}

// 创建单例实例
const selfDiagnosis = new SelfDiagnosis();

module.exports = {
  SelfDiagnosis,
  DIAGNOSIS_CONFIG,
  selfDiagnosis
};