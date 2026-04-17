/**
 * 进化历史记录模块
 * 负责记录所有进化操作和结果，分析成功率和趋势
 */

const fs = require('fs');
const path = require('path');

/**
 * 进化历史配置
 */
const HISTORY_CONFIG = {
  // 存储配置
  storage: {
    dataDir: path.join(__dirname, '../data'),
    historyFile: 'evolution-history.json',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    backupCount: 5,
    autoSaveInterval: 300000 // 5分钟自动保存
  },

  // 分析配置
  analysis: {
    trendWindow: 7 * 24 * 60 * 60 * 1000, // 7天趋势窗口
    successThreshold: 0.7,               // 成功率阈值
    minSamplesForAnalysis: 5,            // 分析所需最小样本数
    retentionPeriod: 30 * 24 * 60 * 60 * 1000 // 30天保留期
  },

  // 报告配置
  reporting: {
    dailyReportTime: '09:00',            // 每日报告时间
    weeklyReportDay: 1,                  // 每周报告（周一）
    reportFormats: ['json', 'markdown']  // 报告格式
  }
};

/**
 * 进化历史管理器
 */
class EvolutionHistory {
  constructor() {
    this.history = [];
    this.stats = {
      totalEvolutions: 0,
      successfulEvolutions: 0,
      failedEvolutions: 0,
      byErrorType: {},
      byActionType: {},
      byDay: {},
      byHour: {}
    };

    this.lastAnalysis = null;
    this.trends = {};

    // 确保数据目录存在
    this.ensureDataDirectory();

    // 加载历史数据
    this.loadHistory();

    // 设置自动保存
    this.setupAutoSave();

    console.log('[EvolutionHistory] 历史管理器已初始化，加载了', this.history.length, '条记录');
  }

  isFinalStatus(status) {
    return status === 'completed' || status === 'failed';
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDirectory() {
    if (!fs.existsSync(HISTORY_CONFIG.storage.dataDir)) {
      fs.mkdirSync(HISTORY_CONFIG.storage.dataDir, { recursive: true });
    }
  }

  /**
   * 加载历史数据
   */
  loadHistory() {
    try {
      const historyPath = path.join(HISTORY_CONFIG.storage.dataDir, HISTORY_CONFIG.storage.historyFile);

      if (fs.existsSync(historyPath)) {
        const fileSize = fs.statSync(historyPath).size;

        // 检查文件大小
        if (fileSize > HISTORY_CONFIG.storage.maxFileSize) {
          console.warn(`[EvolutionHistory] 历史文件过大: ${fileSize} bytes, 开始清理...`);
          this.rotateHistoryFile();
          return;
        }

        const data = fs.readFileSync(historyPath, 'utf8');
        const parsed = JSON.parse(data);

        if (Array.isArray(parsed.history)) {
          this.history = parsed.history;
          this.stats = parsed.stats || this.stats;
          this.lastAnalysis = parsed.lastAnalysis || null;
          this.trends = parsed.trends || {};
          // 使用当前逻辑重算，避免历史统计口径漂移
          this.recalculateStats();
          this.updateAnalysis();

          console.log(`[EvolutionHistory] 从 ${historyPath} 加载了 ${this.history.length} 条记录`);
        }
      }
    } catch (error) {
      console.error('[EvolutionHistory] 加载历史数据失败:', error);
      // 创建备份
      this.backupCorruptedFile();
    }
  }

  /**
   * 保存历史数据
   */
  saveHistory() {
    try {
      const historyPath = path.join(HISTORY_CONFIG.storage.dataDir, HISTORY_CONFIG.storage.historyFile);
      const backupPath = historyPath + '.backup';

      // 创建备份
      if (fs.existsSync(historyPath)) {
        fs.copyFileSync(historyPath, backupPath);
      }

      const data = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        history: this.history,
        stats: this.stats,
        lastAnalysis: this.lastAnalysis,
        trends: this.trends,
        config: HISTORY_CONFIG
      };

      const jsonData = JSON.stringify(data, null, 2);
      fs.writeFileSync(historyPath, jsonData, 'utf8');

      console.log(`[EvolutionHistory] 历史数据已保存，共 ${this.history.length} 条记录`);
    } catch (error) {
      console.error('[EvolutionHistory] 保存历史数据失败:', error);
    }
  }

  /**
   * 设置自动保存
   */
  setupAutoSave() {
    setInterval(() => {
      this.saveHistory();
    }, HISTORY_CONFIG.storage.autoSaveInterval);
  }

  /**
   * 旋转历史文件（创建新文件，备份旧文件）
   */
  rotateHistoryFile() {
    try {
      const historyPath = path.join(HISTORY_CONFIG.storage.dataDir, HISTORY_CONFIG.storage.historyFile);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(HISTORY_CONFIG.storage.dataDir, `evolution-history-${timestamp}.json`);

      if (fs.existsSync(historyPath)) {
        // 移动当前文件到备份
        fs.renameSync(historyPath, backupPath);

        // 只保留最新的备份文件
        this.cleanupOldBackups();
      }

      // 重置历史（只保留最近的重要记录）
      const recentHistory = this.history.slice(-100); // 保留最近100条
      this.history = recentHistory;
      this.recalculateStats();

      console.log('[EvolutionHistory] 历史文件已旋转，保留最近100条记录');
    } catch (error) {
      console.error('[EvolutionHistory] 旋转历史文件失败:', error);
    }
  }

  /**
   * 清理旧备份
   */
  cleanupOldBackups() {
    try {
      const files = fs.readdirSync(HISTORY_CONFIG.storage.dataDir)
        .filter(file => file.startsWith('evolution-history-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(HISTORY_CONFIG.storage.dataDir, file),
          time: fs.statSync(path.join(HISTORY_CONFIG.storage.dataDir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // 按时间倒序

      // 删除超出备份数量的旧文件
      if (files.length > HISTORY_CONFIG.storage.backupCount) {
        const toDelete = files.slice(HISTORY_CONFIG.storage.backupCount);
        toDelete.forEach(file => {
          fs.unlinkSync(file.path);
          console.log(`[EvolutionHistory] 删除旧备份: ${file.name}`);
        });
      }
    } catch (error) {
      console.error('[EvolutionHistory] 清理备份失败:', error);
    }
  }

  /**
   * 备份损坏的文件
   */
  backupCorruptedFile() {
    try {
      const historyPath = path.join(HISTORY_CONFIG.storage.dataDir, HISTORY_CONFIG.storage.historyFile);
      if (fs.existsSync(historyPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(HISTORY_CONFIG.storage.dataDir, `corrupted-history-${timestamp}.json`);
        fs.renameSync(historyPath, backupPath);
        console.log(`[EvolutionHistory] 损坏的文件已备份: ${backupPath}`);
      }
    } catch (error) {
      console.error('[EvolutionHistory] 备份损坏文件失败:', error);
    }
  }

  /**
   * 记录进化操作
   * @param {object} evolutionRecord 进化记录
   */
  recordEvolution(evolutionRecord) {
    const record = {
      id: evolutionRecord.id || `evolution-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: evolutionRecord.timestamp || Date.now(),
      errorType: evolutionRecord.errorType,
      actionType: evolutionRecord.actionType || 'auto_evolve',
      status: evolutionRecord.status || 'pending', // pending, processing, completed, failed
      priority: evolutionRecord.priority || 5,
      riskLevel: evolutionRecord.riskLevel || 'medium',
      details: evolutionRecord.details || {},
      result: evolutionRecord.result || null,
      error: evolutionRecord.error || null,
      metadata: {
        recordedAt: new Date().toISOString(),
        systemVersion: process.version,
        ...evolutionRecord.metadata
      }
    };

    this.history.push(record);
    this.updateStats(record);

    // 触发分析更新
    this.updateAnalysis();
    this.saveHistory();

    console.log(`[EvolutionHistory] 记录进化操作: ${record.id} (${record.errorType})`);
    return record.id;
  }

  /**
   * 更新进化结果
   * @param {string} recordId 记录ID
   * @param {object} result 结果数据
   */
  updateEvolutionResult(recordId, result) {
    const record = this.history.find(r => r.id === recordId);
    if (!record) {
      console.warn(`[EvolutionHistory] 未找到进化记录: ${recordId}`);
      return false;
    }

    record.status = result.success ? 'completed' : 'failed';
    record.result = result.result || null;
    record.error = result.error || null;
    record.completedAt = new Date().toISOString();
    const recordStart = typeof record.timestamp === 'number'
      ? record.timestamp
      : new Date(record.timestamp).getTime();
    record.duration = result.duration || (Date.now() - recordStart);

    // 结果更新属于状态迁移，重算统计避免重复累计
    this.recalculateStats();

    // 触发分析更新
    this.updateAnalysis();
    this.saveHistory();

    console.log(`[EvolutionHistory] 更新进化结果: ${recordId} -> ${record.status}`);
    return true;
  }


  /**
   * 更新统计信息
   */
  updateStats(record) {
    if (!this.isFinalStatus(record.status)) {
      return;
    }

    // 总计数
    this.stats.totalEvolutions++;

    if (record.status === 'completed') {
      this.stats.successfulEvolutions++;
    } else if (record.status === 'failed') {
      this.stats.failedEvolutions++;
    }

    // 按错误类型统计
    const errorType = record.errorType;
    if (!this.stats.byErrorType[errorType]) {
      this.stats.byErrorType[errorType] = { total: 0, success: 0, fail: 0 };
    }
    this.stats.byErrorType[errorType].total++;
    if (record.status === 'completed') {
      this.stats.byErrorType[errorType].success++;
    } else if (record.status === 'failed') {
      this.stats.byErrorType[errorType].fail++;
    }

    // 按动作类型统计
    const actionType = record.actionType;
    if (!this.stats.byActionType[actionType]) {
      this.stats.byActionType[actionType] = { total: 0, success: 0, fail: 0 };
    }
    this.stats.byActionType[actionType].total++;
    if (record.status === 'completed') {
      this.stats.byActionType[actionType].success++;
    } else if (record.status === 'failed') {
      this.stats.byActionType[actionType].fail++;
    }

    // 按日期统计
    const date = new Date(record.timestamp).toISOString().split('T')[0];
    if (!this.stats.byDay[date]) {
      this.stats.byDay[date] = { total: 0, success: 0, fail: 0 };
    }
    this.stats.byDay[date].total++;
    if (record.status === 'completed') {
      this.stats.byDay[date].success++;
    } else if (record.status === 'failed') {
      this.stats.byDay[date].fail++;
    }

    // 按小时统计
    const hour = new Date(record.timestamp).getHours();
    if (!this.stats.byHour[hour]) {
      this.stats.byHour[hour] = { total: 0, success: 0, fail: 0 };
    }
    this.stats.byHour[hour].total++;
    if (record.status === 'completed') {
      this.stats.byHour[hour].success++;
    } else if (record.status === 'failed') {
      this.stats.byHour[hour].fail++;
    }
  }

  /**
   * 重新计算统计信息
   */
  recalculateStats() {
    // 重置统计
    this.stats = {
      totalEvolutions: 0,
      successfulEvolutions: 0,
      failedEvolutions: 0,
      byErrorType: {},
      byActionType: {},
      byDay: {},
      byHour: {}
    };

    // 重新计算
    this.history.forEach(record => this.updateStats(record));
  }

  /**
   * 更新分析数据
   */
  updateAnalysis() {
    const now = Date.now();
    const trendWindow = HISTORY_CONFIG.analysis.trendWindow;
    const cutoffTime = now - trendWindow;

    // 过滤出趋势窗口内的记录
    const recentHistory = this.history.filter(r => r.timestamp > cutoffTime);

    // 计算成功率趋势
    this.calculateSuccessTrends(recentHistory);

    // 计算错误类型分布
    this.calculateErrorTypeDistribution(recentHistory);

    // 计算进化效率
    this.calculateEvolutionEfficiency(recentHistory);

    this.lastAnalysis = {
      timestamp: now,
      windowSize: recentHistory.length,
      trends: this.trends
    };
  }

  /**
   * 计算成功率趋势
   */
  calculateSuccessTrends(recentHistory) {
    if (recentHistory.length < HISTORY_CONFIG.analysis.minSamplesForAnalysis) {
      this.trends.successRate = null;
      return;
    }

    const completed = recentHistory.filter(r => r.status === 'completed').length;
    const failed = recentHistory.filter(r => r.status === 'failed').length;
    const total = completed + failed;

    if (total === 0) {
      this.trends.successRate = null;
      return;
    }

    const successRate = completed / total;

    // 计算趋势（与历史比较）
    const allCompleted = this.history.filter(r => r.status === 'completed').length;
    const allFailed = this.history.filter(r => r.status === 'failed').length;
    const allTotal = allCompleted + allFailed;

    const overallSuccessRate = allTotal > 0 ? allCompleted / allTotal : 0;

    this.trends.successRate = {
      current: successRate,
      overall: overallSuccessRate,
      trend: successRate >= overallSuccessRate ? 'improving' : 'declining',
      confidence: Math.min(total / 10, 1) // 样本越多置信度越高
    };
  }

  /**
   * 计算错误类型分布
   */
  calculateErrorTypeDistribution(recentHistory) {
    const distribution = {};

    recentHistory.forEach(record => {
      const errorType = record.errorType;
      distribution[errorType] = (distribution[errorType] || 0) + 1;
    });

    // 转换为百分比
    const total = recentHistory.length;
    if (total > 0) {
      Object.keys(distribution).forEach(errorType => {
        distribution[errorType] = {
          count: distribution[errorType],
          percentage: distribution[errorType] / total
        };
      });
    }

    this.trends.errorTypeDistribution = distribution;
  }

  /**
   * 计算进化效率
   */
  calculateEvolutionEfficiency(recentHistory) {
    const completedEvolutions = recentHistory.filter(r => r.status === 'completed');

    if (completedEvolutions.length === 0) {
      this.trends.efficiency = null;
      return;
    }

    // 计算平均修复时间
    const avgDuration = completedEvolutions.reduce((sum, r) => {
      return sum + (r.duration || 0);
    }, 0) / completedEvolutions.length;

    // 计算优先级效率（高优先级是否更快修复）
    const priorityGroups = {
      high: completedEvolutions.filter(r => r.priority <= 1),
      medium: completedEvolutions.filter(r => r.priority > 1 && r.priority <= 3),
      low: completedEvolutions.filter(r => r.priority > 3)
    };

    const priorityEfficiency = {};
    Object.entries(priorityGroups).forEach(([level, records]) => {
      if (records.length > 0) {
        const avg = records.reduce((sum, r) => sum + (r.duration || 0), 0) / records.length;
        priorityEfficiency[level] = {
          count: records.length,
          avgDuration: avg,
          efficiency: 1 / (avg / 60000) // 每分钟修复数
        };
      }
    });

    this.trends.efficiency = {
      avgDuration,
      priorityEfficiency,
      throughput: completedEvolutions.length / (HISTORY_CONFIG.analysis.trendWindow / (24 * 60 * 60 * 1000)) // 每天修复数
    };
  }

  /**
   * 获取历史记录
   * @param {object} options 查询选项
   */
  getHistory(options = {}) {
    let filtered = [...this.history];

    // 按时间过滤
    if (options.startTime) {
      filtered = filtered.filter(r => r.timestamp >= options.startTime);
    }
    if (options.endTime) {
      filtered = filtered.filter(r => r.timestamp <= options.endTime);
    }

    // 按错误类型过滤
    if (options.errorType) {
      filtered = filtered.filter(r => r.errorType === options.errorType);
    }

    // 按状态过滤
    if (options.status) {
      filtered = filtered.filter(r => r.status === options.status);
    }

    // 排序
    const sortField = options.sortBy || 'timestamp';
    const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (a[sortField] < b[sortField]) return -1 * sortOrder;
      if (a[sortField] > b[sortField]) return 1 * sortOrder;
      return 0;
    });

    // 分页
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      total: filtered.length,
      limit,
      offset,
      data: paginated
    };
  }

  /**
   * 获取统计报告
   */
  getStatsReport() {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentDay = this.history.filter(r => r.timestamp > dayAgo);
    const recentWeek = this.history.filter(r => r.timestamp > weekAgo);

    return {
      summary: {
        total: this.stats.totalEvolutions,
        success: this.stats.successfulEvolutions,
        fail: this.stats.failedEvolutions,
        successRate: this.stats.totalEvolutions > 0 ?
          this.stats.successfulEvolutions / this.stats.totalEvolutions : 0
      },
      recent: {
        day: {
          total: recentDay.length,
          success: recentDay.filter(r => r.status === 'completed').length,
          fail: recentDay.filter(r => r.status === 'failed').length
        },
        week: {
          total: recentWeek.length,
          success: recentWeek.filter(r => r.status === 'completed').length,
          fail: recentWeek.filter(r => r.status === 'failed').length
        }
      },
      distribution: {
        byErrorType: this.stats.byErrorType,
        byActionType: this.stats.byActionType
      },
      trends: this.trends,
      lastAnalysis: this.lastAnalysis
    };
  }

  /**
   * 生成Markdown报告
   */
  generateMarkdownReport() {
    const stats = this.getStatsReport();
    const now = new Date().toISOString();

    let report = `# 进化历史报告\n\n`;
    report += `生成时间: ${now}\n\n`;

    report += `## 摘要\n\n`;
    report += `- 总进化次数: ${stats.summary.total}\n`;
    report += `- 成功次数: ${stats.summary.success}\n`;
    report += `- 失败次数: ${stats.summary.fail}\n`;
    report += `- 成功率: ${(stats.summary.successRate * 100).toFixed(1)}%\n\n`;

    report += `## 近期活动\n\n`;
    report += `### 过去24小时\n`;
    report += `- 总次数: ${stats.recent.day.total}\n`;
    report += `- 成功: ${stats.recent.day.success}\n`;
    report += `- 失败: ${stats.recent.day.fail}\n\n`;

    report += `### 过去7天\n`;
    report += `- 总次数: ${stats.recent.week.total}\n`;
    report += `- 成功: ${stats.recent.week.success}\n`;
    report += `- 失败: ${stats.recent.week.fail}\n\n`;

    if (stats.trends.successRate) {
      report += `## 趋势分析\n\n`;
      report += `- 当前成功率: ${(stats.trends.successRate.current * 100).toFixed(1)}%\n`;
      report += `- 总体成功率: ${(stats.trends.successRate.overall * 100).toFixed(1)}%\n`;
      report += `- 趋势: ${stats.trends.successRate.trend === 'improving' ? '改善中' : '下降中'}\n`;
      report += `- 置信度: ${(stats.trends.successRate.confidence * 100).toFixed(1)}%\n\n`;
    }

    report += `## 错误类型分布\n\n`;
    Object.entries(stats.distribution.byErrorType).forEach(([errorType, data]) => {
      const percentage = data.total > 0 ? (data.success / data.total * 100).toFixed(1) : '0.0';
      report += `- **${errorType}**: ${data.total}次 (成功率: ${percentage}%)\n`;
    });

    report += `\n## 建议\n\n`;
    if (stats.summary.successRate < HISTORY_CONFIG.analysis.successThreshold) {
      report += `⚠️ **警告**: 成功率低于阈值 ${(HISTORY_CONFIG.analysis.successThreshold * 100).toFixed(0)}%\n`;
      report += `建议审查最近失败的进化操作并优化进化策略。\n`;
    } else {
      report += `✅ 成功率良好，继续保持当前策略。\n`;
    }

    return report;
  }

  /**
   * 清理过期记录
   */
  cleanupOldRecords() {
    const cutoffTime = Date.now() - HISTORY_CONFIG.analysis.retentionPeriod;
    const oldCount = this.history.filter(r => r.timestamp < cutoffTime).length;

    if (oldCount > 0) {
      this.history = this.history.filter(r => r.timestamp >= cutoffTime);
      this.recalculateStats();
      this.updateAnalysis();
      console.log(`[EvolutionHistory] 清理了 ${oldCount} 条过期记录`);
    }
  }

  /**
   * 重置历史
   */
  reset() {
    this.history = [];
    this.stats = {
      totalEvolutions: 0,
      successfulEvolutions: 0,
      failedEvolutions: 0,
      byErrorType: {},
      byActionType: {},
      byDay: {},
      byHour: {}
    };
    this.lastAnalysis = null;
    this.trends = {};

    console.log('[EvolutionHistory] 历史记录已重置');
  }
}

// 创建单例实例
const evolutionHistory = new EvolutionHistory();

module.exports = {
  EvolutionHistory,
  HISTORY_CONFIG,
  evolutionHistory
};
