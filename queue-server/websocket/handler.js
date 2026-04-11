// /workspace/queue-server/websocket/handler.js
const WebSocket = require('ws');
const queueManager = require('../queue/manager');
const customHandler = require('../custom-handler');
const { autoEvolveManager } = require('../evolution/auto-evolve-manager');
const { selfDiagnosis } = require('../evolution/self-diagnosis');
const { evolutionHistory } = require('../evolution/evolution-history');

// Keep track of connected extension clients
let extensionClients = new Set();
// Keep track of web console clients
let webClients = new Set();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    let clientType = 'unknown';

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Handle registration
        if (data.type === 'register') {
          clientType = data.clientType;
          if (clientType === 'extension') {
            extensionClients.add(ws);
            console.log('[WS] Extension registered');
            // Try to assign pending task if any
            assignNextTask();
          } else if (clientType === 'web') {
            webClients.add(ws);
            console.log('[WS] Web client registered');
          }
        }
        
        // Handle ping/pong
        else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }

        // Handle task updates from extension
        else if (data.type === 'task_update') {
          console.log(`[WS] Task update received for ${data.taskId}: ${data.status}`);
          const { taskId, status, result, error } = data;
          
          let task = queueManager.getTask(taskId);
          if (!task) return;

          // Agent 层核心：如果任务状态是 completed，且存在 processResult，交给它处理多轮动作
          if (status === 'completed' && customHandler && typeof customHandler.processResult === 'function') {
            const wsClients = {
              extension: extensionClients.values().next().value,
              web: Array.from(webClients)
            };
            
            customHandler.processResult(task, result, wsClients).then(processRes => {
              if (processRes.status === 'processing') {
                // 还有下一轮，继续发送 prompt
                queueManager.updateTask(taskId, { status: 'processing' });
                
                // 将下一轮反馈发给扩展
                if (wsClients.extension && wsClients.extension.readyState === WebSocket.OPEN) {
                  wsClients.extension.send(JSON.stringify({
                    type: 'task_assigned',
                    task: { ...task, prompt: processRes.nextPrompt }
                  }));
                }
                
                broadcastToWeb({
                  type: 'task_update',
                  task: queueManager.getTask(taskId)
                });
              } else {
                // 真正结束
                finishTaskUpdate(taskId, processRes.status, processRes.result || processRes.result, processRes.error);
              }
            }).catch(err => {
              finishTaskUpdate(taskId, 'failed', null, err.message);
            });
          } else {
            finishTaskUpdate(taskId, status, result, error);
          }
        }
        
        // 处理扩展动作执行的回调 (比如 new_session, screenshot)
        else if (data.type === 'action_result') {
          // TODO: 将来支持更复杂的扩展内动作反馈
          console.log(`[WS] Extension action result received for task ${data.taskId}`);
        }
        
        // 处理扩展自动发起的进化请求
        else if (data.type === 'auto_evolve') {
          console.log(`[WS] Auto-evolve request received: ${data.errorType}`);

          // 使用进化策略管理器检查是否允许进化
          const evolutionCheck = autoEvolveManager.shouldAllowEvolution(data.errorType, data);

          if (!evolutionCheck.allowed) {
            console.log(`[WS] Evolution not allowed: ${evolutionCheck.reason}`);

            // 通知扩展进化被限制
            if (extensionClients.has(ws)) {
              ws.send(JSON.stringify({
                type: 'evolution_rate_limited',
                errorType: data.errorType,
                message: evolutionCheck.reason || 'Evolution not allowed at this time.',
                priority: evolutionCheck.priority,
                riskLevel: evolutionCheck.riskLevel
              }));
            }
            return;
          }

          // 生成诊断报告
          const diagnosisReport = selfDiagnosis.analyzeError(data);

          // 记录进化请求到历史
          const evolutionId = autoEvolveManager.recordEvolutionRequest(data);
          evolutionHistory.recordEvolution({
            id: evolutionId,
            errorType: data.errorType,
            actionType: 'auto_evolve',
            priority: evolutionCheck.priority,
            riskLevel: evolutionCheck.riskLevel,
            details: data.details || {},
            timestamp: data.timestamp || Date.now()
          });

          // 获取进化建议
          const evolutionAdvice = autoEvolveManager.getEvolutionAdvice(data.errorType, data.details);

          // 根据错误类型生成智能提示（使用诊断报告增强）
          const prompt = generateEvolutionPrompt(data, diagnosisReport, evolutionAdvice);

          // 确定任务优先级（从管理器获取）
          const priority = evolutionCheck.priority;

          // 自动创建一个新任务放到队列头部
          const task = queueManager.addTask(prompt, {
            autoEvolve: true,
            skipSystemInstruction: false,
            maxRounds: data.maxRounds || 5,
            priority: priority,
            evolutionRequest: {
              id: evolutionId,
              errorType: data.errorType,
              errorMessage: data.errorMessage,
              location: data.location,
              timestamp: data.timestamp || new Date().toISOString(),
              details: data.details || {},
              diagnosis: diagnosisReport,
              advice: evolutionAdvice
            }
          });

          console.log(`[WS] Auto-evolve task created: ${task.id}, priority: ${priority}, risk: ${evolutionCheck.riskLevel}`);

          broadcastToWeb({ type: 'task_update', task });
          assignNextTask();
        }
      } catch (err) {
        console.error('[WS] Error parsing message:', err);
      }
    });

    function finishTaskUpdate(taskId, status, result, error) {
      const updatedTask = queueManager.updateTask(taskId, { status, result, error });
      if (updatedTask) {
        // Broadcast update to web clients
        broadcastToWeb({
          type: 'task_update',
          task: updatedTask
        });

        // If task is completed or failed, we can try to assign the next one
        if (status === 'completed' || status === 'failed') {
          assignNextTask();
        }
      }
    }

    ws.on('close', () => {
      console.log(`[WS] Client disconnected (${clientType})`);
      if (clientType === 'extension') {
        extensionClients.delete(ws);
      } else if (clientType === 'web') {
        webClients.delete(ws);
      }
    });
  });
}

// Push next pending task to an available extension client
function assignNextTask() {
  if (extensionClients.size === 0) {
    return;
  }

  // Currently just pick the first available extension client
  const client = extensionClients.values().next().value;
  if (client && client.readyState === WebSocket.OPEN) {
    const nextTask = queueManager.getNextPendingTask();
    if (nextTask) {
      // Update status to processing
      queueManager.updateTask(nextTask.id, { status: 'processing' });
      
      // Apply custom evolutionary logic to the prompt
      let processedPrompt = nextTask.prompt;
      try {
        if (customHandler && typeof customHandler.processTask === 'function') {
          processedPrompt = customHandler.processTask(nextTask);
        }
      } catch (err) {
        console.error('[WS] Error in custom-handler:', err);
      }
      
      // Send task to extension
      client.send(JSON.stringify({
        type: 'task_assigned',
        task: { ...nextTask, prompt: processedPrompt }
      }));

      // Broadcast update to web clients
      broadcastToWeb({
        type: 'task_update',
        task: queueManager.getTask(nextTask.id)
      });
      
      console.log(`[WS] Assigned task ${nextTask.id} to extension`);
    }
  }
}

// Expose broadcast to web clients so HTTP API can use it
function broadcastToWeb(message) {
  const msgStr = JSON.stringify(message);
  for (const client of webClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }
}

function broadcastToExtensions(message) {
  const msgStr = JSON.stringify(message);
  for (const client of extensionClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }
}

// Expose trigger to check queue when new tasks arrive
function triggerAssign() {
  assignNextTask();
}

// ======================== 自动进化辅助函数 ========================

// 进化请求历史记录（用于频率限制）
const evolutionRequestHistory = new Map();
const EVOLUTION_CONFIG = {
  maxPerHour: 3,           // 每小时最大进化次数
  maxPerDay: 10,           // 每天最大进化次数
  coolingPeriod: 3600000,  // 相同错误冷却期：1小时（毫秒）
  minInterval: 300000      // 最小进化间隔：5分钟（毫秒）
};

/**
 * 检查是否允许自动进化
 * @param {string} errorType 错误类型
 * @returns {boolean} 是否允许进化
 */
function shouldAllowAutoEvolve(errorType) {
  const now = Date.now();
  const hourAgo = now - 3600000; // 1小时前
  const dayAgo = now - 86400000; // 24小时前

  // 获取进化历史
  const history = Array.from(evolutionRequestHistory.values());

  // 检查每小时限制
  const recentEvolves = history.filter(req => req.timestamp > hourAgo);
  if (recentEvolves.length >= EVOLUTION_CONFIG.maxPerHour) {
    console.log(`[WS Evolution] Hourly limit reached: ${recentEvolves.length}/${EVOLUTION_CONFIG.maxPerHour}`);
    return false;
  }

  // 检查每天限制
  const dailyEvolves = history.filter(req => req.timestamp > dayAgo);
  if (dailyEvolves.length >= EVOLUTION_CONFIG.maxPerDay) {
    console.log(`[WS Evolution] Daily limit reached: ${dailyEvolves.length}/${EVOLUTION_CONFIG.maxPerDay}`);
    return false;
  }

  // 检查相同错误冷却期
  const sameErrorEvolves = history.filter(req =>
    req.errorType === errorType &&
    (now - req.timestamp) < EVOLUTION_CONFIG.coolingPeriod
  );
  if (sameErrorEvolves.length > 0) {
    console.log(`[WS Evolution] Cooling period for ${errorType}: ${sameErrorEvolves.length} recent evolves`);
    return false;
  }

  // 检查最小间隔
  if (history.length > 0) {
    const lastEvolve = Math.max(...history.map(req => req.timestamp));
    if (now - lastEvolve < EVOLUTION_CONFIG.minInterval) {
      console.log(`[WS Evolution] Min interval not met: ${now - lastEvolve}ms since last evolve`);
      return false;
    }
  }

  return true;
}

/**
 * 记录进化请求
 * @param {object} evolutionData 进化数据
 */
function recordEvolutionRequest(evolutionData) {
  const requestId = `evolve-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  const record = {
    id: requestId,
    errorType: evolutionData.errorType,
    errorMessage: evolutionData.errorMessage,
    location: evolutionData.location,
    timestamp: evolutionData.timestamp || Date.now(),
    recordedAt: new Date().toISOString()
  };

  evolutionRequestHistory.set(requestId, record);

  // 清理旧记录（保留最近100条）
  if (evolutionRequestHistory.size > 100) {
    const keys = Array.from(evolutionRequestHistory.keys());
    const oldestKey = keys.reduce((oldest, key) => {
      return evolutionRequestHistory.get(key).timestamp < evolutionRequestHistory.get(oldest).timestamp ? key : oldest;
    });
    evolutionRequestHistory.delete(oldestKey);
  }

  console.log(`[WS Evolution] Recorded evolution request: ${requestId} for ${evolutionData.errorType}`);
}

/**
 * 根据错误类型生成进化提示
 * @param {object} evolutionData 进化数据
 * @param {object} diagnosisReport 诊断报告（可选）
 * @param {object} evolutionAdvice 进化建议（可选）
 * @returns {string} 生成的提示
 */
function generateEvolutionPrompt(evolutionData, diagnosisReport = null, evolutionAdvice = null) {
  const { errorType, errorMessage, location, currentCode, details = {} } = evolutionData;

  // 根据错误类型生成不同的提示模板
  const promptTemplates = {
    websocket_connection_error: `[自动进化任务] WebSocket连接问题修复

系统检测到WebSocket连接问题：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 连接地址: ${location || '未知'}

请分析WebSocket连接失败的原因，并提供修复方案。考虑：
1. 检查连接地址是否正确
2. 检查网络连接状态
3. 优化重连逻辑
4. 添加错误处理和恢复机制

请使用合适的进化动作（evolve_extension或evolve_handler）应用修复。`,

    dom_selector_not_found: `[自动进化任务] DOM选择器失效修复

系统检测到DOM选择器失效：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 选择器: ${details.selector || '未知'}
- 页面上下文: ${details.context || '未知'}
- 页面URL: ${details.url || '未知'}

请分析选择器失效的原因（可能是页面结构变化），并提供修复方案。考虑：
1. 更新选择器以适应新的页面结构
2. 添加备用选择器或回退机制
3. 优化元素查找逻辑
4. 添加更好的错误处理和重试机制

请使用evolve_extension动作更新content.js或相关文件。`,

    task_execution_timeout: `[自动进化任务] 任务执行性能优化

系统检测到任务执行超时：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 任务ID: ${details.taskId || '未知'}
- 执行时间: ${details.duration || '未知'}ms
- 阈值: ${details.threshold || 30000}ms

请分析性能瓶颈原因，并提供优化方案。考虑：
1. 优化任务执行逻辑
2. 减少不必要的等待时间
3. 添加超时处理和取消机制
4. 优化资源使用和内存管理

请使用合适的进化动作应用性能优化。`,

    websocket_message_error: `[自动进化任务] WebSocket消息处理问题修复

系统检测到WebSocket消息处理错误：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 消息内容: ${details.data ? details.data.substring(0, 200) : '未知'}
- 发生时间: ${details.timestamp || '未知'}

请分析WebSocket消息处理失败的原因，并提供修复方案。考虑：
1. 检查消息格式和编码
2. 优化消息解析逻辑
3. 添加消息验证和错误处理
4. 增强消息处理容错性

请使用evolve_extension或evolve_handler动作修复消息处理逻辑。`,

    content_script_injection_failed: `[自动进化任务] 内容脚本注入失败修复

系统检测到内容脚本注入失败：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 注入页面: ${details.url || '未知'}
- 脚本名称: ${details.scriptName || 'content.js'}
- 失败原因: ${details.reason || '未知'}

请分析内容脚本注入失败的原因，并提供修复方案。考虑：
1. 检查页面权限和内容安全策略
2. 优化脚本注入时机和方式
3. 添加注入重试和回退机制
4. 改进脚本兼容性和错误处理

请使用evolve_extension动作更新内容脚本注入逻辑。`,

    task_execution_failed: `[自动进化任务] 任务执行失败修复

系统检测到任务执行失败：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 任务ID: ${details.taskId || '未知'}
- 执行上下文: ${details.context || '未知'}
- 失败原因: ${details.failureReason || '未知'}

请分析任务执行失败的根本原因，并提供修复方案。考虑：
1. 检查任务参数和环境依赖
2. 优化错误处理和恢复机制
3. 添加任务重试和补偿逻辑
4. 改进任务执行流程和监控

请使用合适的进化动作修复任务执行逻辑。`,

    api_response_error: `[自动进化任务] API响应错误修复

系统检测到API响应错误：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- API地址: ${details.url || '未知'}
- 状态码: ${details.status || '未知'}
- 响应内容: ${details.response ? details.response.substring(0, 200) : '未知'}

请分析API响应错误的原因，并提供修复方案。考虑：
1. 检查API端点的可用性和权限
2. 优化请求参数和头部信息
3. 添加响应验证和错误处理
4. 实现重试机制和备用方案

请使用合适的进化动作修复API调用逻辑。`,

    extension_permission_error: `[自动进化任务] 扩展权限错误修复

系统检测到扩展权限错误：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 权限类型: ${details.permission || '未知'}
- 操作目标: ${details.target || '未知'}
- 失败原因: ${details.reason || '权限不足或未声明'}

请分析扩展权限错误的原因，并提供修复方案。考虑：
1. 检查manifest.json中的权限声明
2. 优化权限请求时机和方式
3. 添加权限检查和优雅降级
4. 更新权限声明或使用替代方案

请使用evolve_extension动作更新manifest.json或权限处理逻辑。`,

    page_load_timeout: `[自动进化任务] 页面加载超时优化

系统检测到页面加载超时：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 页面URL: ${details.url || '未知'}
- 超时时间: ${details.timeout || '未知'}ms
- 加载阶段: ${details.phase || '未知'}

请分析页面加载超时的原因，并提供优化方案。考虑：
1. 优化页面加载策略和资源管理
2. 添加加载进度监控和超时处理
3. 实现页面缓存和预加载机制
4. 改进网络连接和重试逻辑

请使用evolve_extension动作优化页面加载逻辑。`,

    element_interaction_failed: `[自动进化任务] 元素交互失败修复

系统检测到元素交互失败：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 元素选择器: ${details.selector || '未知'}
- 交互类型: ${details.interaction || '未知'}
- 失败原因: ${details.reason || '元素不存在或不可交互'}

请分析元素交互失败的原因，并提供修复方案。考虑：
1. 更新元素选择器以适应页面变化
2. 优化元素等待和查找逻辑
3. 添加交互重试和错误处理
4. 改进元素状态检测和验证

请使用evolve_extension动作修复元素交互逻辑。`,

    default: `[自动进化任务] 系统问题修复

系统检测到以下问题需要修复：
- 错误类型: ${errorType}
- 错误信息: ${errorMessage}
- 发生位置: ${location || 'Unknown'}
- 相关代码: ${currentCode || 'Unknown'}
- 详细信息: ${JSON.stringify(details, null, 2).substring(0, 500)}

请分析问题原因并提供修复后的完整代码。使用合适的进化动作来应用修改。`
  };

  let template = promptTemplates[errorType] || promptTemplates.default;

  // 如果提供了诊断报告，增强提示
  if (diagnosisReport) {
    template += `\n\n## 诊断分析\n`;
    template += `系统诊断报告：\n`;
    template += `- 主要可能原因: ${diagnosisReport.analysis.mostLikelyCause}\n`;
    template += `- 严重程度: ${diagnosisReport.severity.level}\n`;
    template += `- 置信度: ${(diagnosisReport.analysis.confidence * 100).toFixed(1)}%\n`;

    if (diagnosisReport.analysis.rootCauses && diagnosisReport.analysis.rootCauses.length > 0) {
      template += `- 其他可能原因:\n`;
      diagnosisReport.analysis.rootCauses.slice(0, 3).forEach(cause => {
        template += `  * ${cause}\n`;
      });
    }

    template += `\n## 修复建议\n`;
    if (diagnosisReport.suggestions.immediate && diagnosisReport.suggestions.immediate.length > 0) {
      template += `立即行动:\n`;
      diagnosisReport.suggestions.immediate.slice(0, 3).forEach(action => {
        template += `- ${action}\n`;
      });
    }

    if (diagnosisReport.suggestions.shortTerm && diagnosisReport.suggestions.shortTerm.length > 0) {
      template += `\n短期修复:\n`;
      diagnosisReport.suggestions.shortTerm.slice(0, 3).forEach(action => {
        template += `- ${action}\n`;
      });
    }
  }

  // 如果提供了进化建议，添加建议
  if (evolutionAdvice) {
    template += `\n## 进化策略建议\n`;
    template += `- 推荐动作: ${evolutionAdvice.suggestedActions?.join(', ') || 'evolve_extension'}\n`;
    template += `- 关注领域: ${evolutionAdvice.focusAreas?.join(', ') || '错误处理'}\n`;
    template += `- 风险等级: ${evolutionAdvice.riskLevel || 'medium'}\n`;
    template += `- 预估工作量: ${evolutionAdvice.estimatedEffort || '中等'}\n`;
  }

  // 添加智能进化指引
  template += `\n\n## 智能进化指引\n`;
  template += `请根据以上分析，使用合适的进化动作修复问题。确保：\n`;
  template += `1. 代码语法正确且通过验证\n`;
  template += `2. 修改范围控制在必要的最小集合\n`;
  template += `3. 保持向后兼容性\n`;
  template += `4. 添加适当的错误处理和日志\n`;
  template += `5. 如果涉及关键系统文件，优先考虑低风险方案\n`;

  return template;
}

/**
 * 获取进化优先级
 * @param {string} errorType 错误类型
 * @returns {number} 优先级（0-9，0最高）
 */
function getEvolutionPriority(errorType) {
  const priorityMap = {
    websocket_connection_error: 0,  // 最高优先级：连接问题
    websocket_message_error: 1,     // 高优先级：消息处理问题
    dom_selector_not_found: 1,       // 高优先级：功能失效
    task_execution_failed: 1,        // 高优先级：任务失败
    content_script_injection_failed: 2, // 中高优先级：脚本注入失败
    extension_permission_error: 2,   // 中高优先级：权限问题
    task_execution_timeout: 3,       // 中优先级：性能问题
    page_load_timeout: 3,            // 中优先级：页面加载问题
    element_interaction_failed: 3,   // 中优先级：元素交互问题
    api_response_error: 4,           // 中低优先级：API问题
    default: 5                       // 默认优先级
  };

  return priorityMap[errorType] !== undefined ? priorityMap[errorType] : priorityMap.default;
}

/**
 * 获取进化历史统计
 * @returns {object} 进化统计信息
 */
function getEvolutionStats() {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const dayAgo = now - 86400000;

  const history = Array.from(evolutionRequestHistory.values());

  const stats = {
    total: history.length,
    lastHour: history.filter(req => req.timestamp > hourAgo).length,
    lastDay: history.filter(req => req.timestamp > dayAgo).length,
    byErrorType: {},
    recentRequests: history.slice(-10).map(req => ({
      errorType: req.errorType,
      timestamp: new Date(req.timestamp).toISOString(),
      location: req.location
    }))
  };

  // 按错误类型统计
  history.forEach(req => {
    stats.byErrorType[req.errorType] = (stats.byErrorType[req.errorType] || 0) + 1;
  });

  return stats;
}

// 导出主函数和辅助函数
const handlerExports = setupWebSocket;
handlerExports.shouldAllowAutoEvolve = shouldAllowAutoEvolve;
handlerExports.recordEvolutionRequest = recordEvolutionRequest;
handlerExports.generateEvolutionPrompt = generateEvolutionPrompt;
handlerExports.getEvolutionPriority = getEvolutionPriority;
handlerExports.getEvolutionStats = getEvolutionStats;
handlerExports.broadcastToWeb = broadcastToWeb;
handlerExports.broadcastToExtensions = broadcastToExtensions;
handlerExports.triggerAssign = triggerAssign;

module.exports = handlerExports;
