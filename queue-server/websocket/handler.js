// /workspace/queue-server/websocket/handler.js
const WebSocket = require('ws');
const queueManager = require('../queue/manager');
const customHandler = require('../custom-handler');
const { autoEvolveManager } = require('../evolution/auto-evolve-manager');
const { selfDiagnosis } = require('../evolution/self-diagnosis');
const { evolutionHistory } = require('../evolution/evolution-history');
const conversationStore = require('../conversations/store');
const providerRegistry = require('../providers');

const confirmManager = require('../actions/confirm-manager');

// Keep track of connected extension clients
let extensionClients = new Set();
// Keep track of web console clients
let webClients = new Set();
let deepseekWebBusy = false;

// 注入 webClients 引用到 confirmManager，让它能推送审批请求到前端
confirmManager.setWebClients(webClients);
confirmManager.setEventBroadcaster(broadcastRealtimeEvent);

function formatTaskError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  const prefix = error.code ? `[${error.code}] ` : '';
  return `${prefix}${error.message || String(error)}`;
}

function getProcessedPrompt(task) {
  let processedPrompt = task.prompt;

  try {
    if (customHandler && typeof customHandler.processTask === 'function') {
      processedPrompt = customHandler.processTask(task);
    }
  } catch (error) {
    console.error('[WS] Error in custom-handler:', error);
  }

  return processedPrompt;
}

function extractProviderResult(providerResult) {
  if (typeof providerResult === 'string') {
    return providerResult;
  }

  if (providerResult && typeof providerResult.text === 'string') {
    return providerResult.text;
  }

  if (providerResult && typeof providerResult.result === 'string') {
    return providerResult.result;
  }

  return '';
}

function finishTaskUpdate(taskId, status, result, error) {
  const normalizedError = error ? formatTaskError(error) : null;
  const updatedTask = queueManager.updateTask(taskId, {
    status,
    result,
    error: status === 'failed' ? normalizedError : error || null
  });

  if (!updatedTask) {
    return;
  }

  if (updatedTask.options?.conversationId) {
    try {
      const messages = [];
      if (status === 'completed' && result) {
        messages.push({
          role: 'assistant',
          content: result,
          source: 'task_result',
          metadata: {
            taskId,
            status,
            provider: providerRegistry.getTaskProvider(updatedTask)
          }
        });
      }

      if (status === 'failed' && normalizedError) {
        messages.push({
          role: 'system',
          content: normalizedError,
          source: 'task_error',
          metadata: {
            taskId,
            status,
            provider: providerRegistry.getTaskProvider(updatedTask)
          }
        });
      }

      if (messages.length > 0) {
        const syncResult = conversationStore.syncConversation(updatedTask.options.conversationId, {
          metadata: {
            lastTaskId: taskId,
            lastTaskStatus: status,
            lastTaskProvider: providerRegistry.getTaskProvider(updatedTask),
            lastTaskUpdatedAt: updatedTask.updatedAt
          },
          messages
        });

        broadcastToWeb({
          type: 'conversation_updated',
          conversation: syncResult.conversation
        });
      }
    } catch (conversationError) {
      console.error('[WS] Failed to persist task update into conversation:', conversationError);
    }
  }

  const evolutionRequest = updatedTask?.options?.autoEvolve === true
    ? updatedTask.options.evolutionRequest
    : null;
  if (evolutionRequest?.id && (status === 'completed' || status === 'failed')) {
    evolutionHistory.updateEvolutionResult(evolutionRequest.id, {
      success: status === 'completed',
      result,
      error: normalizedError,
      duration: updatedTask.createdAt
        ? (Date.now() - new Date(updatedTask.createdAt).getTime())
        : undefined
    });
  }

  broadcastToWeb({
    type: 'task_update',
    task: updatedTask
  });

  if (status === 'completed' || status === 'failed') {
    assignNextTask();
  }
}

async function executeServerSideTask(task) {
  const providerId = providerRegistry.getTaskProvider(task);
  const processedPrompt = getProcessedPrompt(task);
  const executionTask = {
    ...task,
    prompt: processedPrompt
  };

  if (providerId === 'deepseek-web') {
    deepseekWebBusy = true;
  }

  try {
    const providerResult = await providerRegistry.executeTask(executionTask, {
      prompt: processedPrompt
    });
    if (providerId === 'deepseek-web') {
      deepseekWebBusy = false;
    }
    finishTaskUpdate(task.id, 'completed', extractProviderResult(providerResult), null);
  } catch (error) {
    if (providerId === 'deepseek-web') {
      deepseekWebBusy = false;
    }
    const formattedError = formatTaskError(error);
    console.warn(`[WS] ${providerId} task ${task.id} failed: ${formattedError}`);
    finishTaskUpdate(task.id, 'failed', null, formattedError);
  }
}

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
                const nextRoundTask = queueManager.updateTask(taskId, {
                  status: 'processing',
                  prompt: processRes.nextPrompt,
                  round: task.round
                });

                // 将下一轮反馈发给扩展
                if (wsClients.extension && wsClients.extension.readyState === WebSocket.OPEN && nextRoundTask) {
                  wsClients.extension.send(JSON.stringify({
                    type: 'task_assigned',
                    task: nextRoundTask
                  }));
                } else {
                  const requeuedTask = queueManager.requeueTask(taskId, {
                    prompt: processRes.nextPrompt,
                    round: task.round
                  });

                  if (requeuedTask) {
                    console.warn(`[WS] Re-queued task ${taskId} because no extension was available for round ${task.round}`);
                  }
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
        else if (data.type === 'action_result' || data.type === 'browser_action_result') {
          console.log(`[WS] Extension action result received for request ${data.requestId || 'unknown'}`);

          if (data.requestId) {
            conversationStore.completeBrowserAction({
              requestId: data.requestId,
              status: data.success === false ? 'failed' : 'completed',
              result: data.result || data.response || null,
              error: data.error || null
            });
          }

          if (data.conversationId && data.syncPayload) {
            try {
              const syncResult = conversationStore.syncConversation(data.conversationId, data.syncPayload);
              broadcastToWeb({
                type: 'conversation_updated',
                conversation: syncResult.conversation
              });
            } catch (syncError) {
              console.error('[WS] Failed to sync conversation from browser action result:', syncError);
            }
          }

          broadcastToWeb({
            type: 'browser_action_result',
            requestId: data.requestId,
            conversationId: data.conversationId,
            success: data.success !== false,
            result: data.result || data.response || null,
            error: data.error || null
          });
        }
        
        // 处理扩展自动发起的进化请求
        else if (data.type === 'auto_evolve') {
          console.log(`[WS] Auto-evolve request received: ${data.errorType}`);

          try {
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
          } catch (evolveErr) {
            console.error('[WS] Auto-evolve processing error:', evolveErr);
            if (extensionClients.has(ws)) {
              ws.send(JSON.stringify({
                type: 'evolution_error',
                errorType: data.errorType,
                message: 'Internal error processing auto_evolve request.'
              }));
            }
          }
        }
      } catch (err) {
        console.error('[WS] Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected (${clientType})`);
      if (clientType === 'extension') {
        extensionClients.delete(ws);
        if (extensionClients.size === 0) {
          const requeuedTasks = queueManager.requeueProcessingTasks((task) => (
            !providerRegistry.isServerSideProvider(providerRegistry.getTaskProvider(task))
          ));
          for (const requeuedTask of requeuedTasks) {
            broadcastToWeb({
              type: 'task_update',
              task: requeuedTask
            });
          }

          assignNextTask();
        }
      } else if (clientType === 'web') {
        webClients.delete(ws);
      }
    });
  });
}

// Dispatch the next pending task to an available execution channel.
function assignNextTask() {
  const client = extensionClients.values().next().value;
  const extensionAvailable = Boolean(client && client.readyState === WebSocket.OPEN);
  const nextTask = queueManager.getNextPendingTask((task) => providerRegistry.canDispatchTask(task, {
    extensionAvailable,
    deepseekWebBusy
  }));

  if (!nextTask) {
    return;
  }

  const providerId = providerRegistry.getTaskProvider(nextTask);
  const updatedTask = queueManager.updateTask(nextTask.id, {
    status: 'processing',
    executionChannel: providerRegistry.isServerSideProvider(providerId) ? 'queue-server' : 'extension'
  });

  if (!updatedTask) {
    return;
  }

  broadcastToWeb({
    type: 'task_update',
    task: updatedTask
  });

  if (providerRegistry.isServerSideProvider(providerId)) {
    console.log(`[WS] Executing task ${nextTask.id} via ${providerId} inside queue-server`);
    executeServerSideTask(updatedTask);
    return;
  }

  if (!extensionAvailable) {
    const requeuedTask = queueManager.requeueTask(nextTask.id, {
      executionChannel: null
    });
    if (requeuedTask) {
      broadcastToWeb({
        type: 'task_update',
        task: requeuedTask
      });
    }
    return;
  }

  const processedPrompt = getProcessedPrompt(updatedTask);
  client.send(JSON.stringify({
    type: 'task_assigned',
    task: {
      ...updatedTask,
      prompt: processedPrompt
    }
  }));

  console.log(`[WS] Assigned task ${nextTask.id} to extension`);
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

function broadcastRealtimeEvent(message) {
  broadcastToWeb(message);
  broadcastToExtensions(message);
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

  const promptTemplates = {
    websocket_connection_error: `[自动进化] WebSocket连接失败
错误: ${errorMessage}
地址: ${location || '未知'}
请分析原因并使用evolve_extension或evolve_handler修复。`,

    dom_selector_not_found: `[自动进化] DOM选择器失效
错误: ${errorMessage}
选择器: ${details.selector || '未知'}
页面: ${details.url || '未知'}
请分析原因并使用evolve_extension修复content.js。`,

    task_execution_timeout: `[自动进化] 任务执行超时
错误: ${errorMessage}
任务: ${details.taskId || '未知'}
耗时: ${details.duration || '未知'}ms / 阈值: ${details.threshold || 30000}ms
请优化执行逻辑并使用合适的进化动作修复。`,

    websocket_message_error: `[自动进化] WebSocket消息处理错误
错误: ${errorMessage}
请检查消息格式和解析逻辑，使用evolve_extension或evolve_handler修复。`,

    content_script_injection_failed: `[自动进化] 内容脚本注入失败
错误: ${errorMessage}
页面: ${details.url || '未知'}
请优化注入逻辑并使用evolve_extension修复。`,

    task_execution_failed: `[自动进化] 任务执行失败
错误: ${errorMessage}
任务: ${details.taskId || '未知'}
请分析根因并使用合适的进化动作修复。`,

    api_response_error: `[自动进化] API响应错误
错误: ${errorMessage}
地址: ${details.url || '未知'} 状态: ${details.status || '未知'}
请优化请求逻辑并使用合适的进化动作修复。`,

    extension_permission_error: `[自动进化] 扩展权限错误
错误: ${errorMessage}
权限: ${details.permission || '未知'}
请检查manifest.json并使用evolve_extension修复。`,

    page_load_timeout: `[自动进化] 页面加载超时
错误: ${errorMessage}
页面: ${details.url || '未知'}
请优化加载策略并使用evolve_extension修复。`,

    element_interaction_failed: `[自动进化] 元素交互失败
错误: ${errorMessage}
选择器: ${details.selector || '未知'}
请更新选择器并使用evolve_extension修复。`,

    default: `[自动进化] 系统问题
错误类型: ${errorType}
错误: ${errorMessage}
位置: ${location || 'Unknown'}
代码: ${currentCode || 'Unknown'}
请分析原因并使用合适的进化动作修复。`
  };

  let template = promptTemplates[errorType] || promptTemplates.default;

  if (diagnosisReport) {
    template += `\n\n诊断: ${diagnosisReport.analysis.mostLikelyCause} (${diagnosisReport.severity.level}, 置信度${(diagnosisReport.analysis.confidence * 100).toFixed(0)}%)`;
    if (diagnosisReport.suggestions.immediate && diagnosisReport.suggestions.immediate.length > 0) {
      template += `\n建议: ${diagnosisReport.suggestions.immediate.slice(0, 2).join('; ')}`;
    }
  }

  if (evolutionAdvice) {
    template += `\n推荐: ${evolutionAdvice.suggestedActions?.join('/') || 'evolve_extension'} (风险: ${evolutionAdvice.riskLevel || 'medium'})`;
  }

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
