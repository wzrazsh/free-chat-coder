// /workspace/queue-server/websocket/handler.js
const WebSocket = require('ws');
const queueManager = require('../queue/manager');
const customHandler = require('../custom-handler');
const conversationStore = require('../conversations/store');
const providerRegistry = require('../providers');
const sharedConfig = require('../../shared/config');

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

function finishTaskUpdate(taskId, status, result, error, options = {}) {
  const taskUpdates = options && typeof options.taskUpdates === 'object' ? options.taskUpdates : {};
  const conversationMetadata = options && typeof options.conversationMetadata === 'object'
    ? options.conversationMetadata
    : null;
  const normalizedError = error ? formatTaskError(error) : null;
  const updatedTask = queueManager.updateTask(taskId, {
    status,
    result,
    error: status === 'failed' ? normalizedError : error || null,
    ...taskUpdates
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
            lastTaskUpdatedAt: updatedTask.updatedAt,
            ...(conversationMetadata || {})
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

  broadcastToWeb({
    type: 'task_update',
    task: updatedTask
  });

  if (status === 'completed' || status === 'failed') {
    assignNextTask();
  }
}

function getWsClients() {
  return {
    extension: extensionClients.values().next().value,
    web: Array.from(webClients)
  };
}

function continueTaskProcessing(task, nextPrompt, options = {}) {
  const taskUpdates = options && typeof options.taskUpdates === 'object' ? options.taskUpdates : {};
  const updatedTask = queueManager.updateTask(task.id, {
    status: 'processing',
    prompt: nextPrompt,
    round: task.round,
    ...taskUpdates
  });

  if (!updatedTask) {
    return;
  }

  broadcastToWeb({
    type: 'task_update',
    task: updatedTask
  });

  const providerId = providerRegistry.getTaskProvider(updatedTask);
  if (providerRegistry.isServerSideProvider(providerId)) {
    executeServerSideTask(updatedTask);
    return;
  }

  const extensionClient = extensionClients.values().next().value;
  if (extensionClient && extensionClient.readyState === WebSocket.OPEN) {
    extensionClient.send(JSON.stringify({
      type: 'task_assigned',
      task: {
        ...updatedTask,
        prompt: getProcessedPrompt(updatedTask)
      }
    }));
  } else {
    const requeuedTask = queueManager.requeueTask(task.id, {
      prompt: nextPrompt,
      round: task.round,
      ...taskUpdates
    });

    if (requeuedTask) {
      console.warn(`[WS] Re-queued task ${task.id} because no extension was available for round ${task.round}`);
      broadcastToWeb({
        type: 'task_update',
        task: requeuedTask
      });
      return;
    }
  }
}

async function handleCompletedTaskResult(task, replyText, options = {}) {
  const taskUpdates = options && typeof options.taskUpdates === 'object' ? options.taskUpdates : {};
  const conversationMetadata = options && typeof options.conversationMetadata === 'object'
    ? options.conversationMetadata
    : {};

  if (!customHandler || typeof customHandler.processResult !== 'function') {
    finishTaskUpdate(task.id, 'completed', replyText, null, {
      taskUpdates,
      conversationMetadata
    });
    return;
  }

  try {
    const processRes = await customHandler.processResult(task, replyText, getWsClients());

    if (processRes.status === 'processing') {
      if (processRes.requiresExtension && !processRes.extensionActionsDispatched) {
        finishTaskUpdate(
          task.id,
          'failed',
          null,
          'Browser extension execution is required for this task, but no extension client is connected.',
          {
            taskUpdates,
            conversationMetadata
          }
        );
        return;
      }

      continueTaskProcessing(task, processRes.nextPrompt, {
        taskUpdates
      });
      return;
    }

    finishTaskUpdate(task.id, processRes.status, processRes.result ?? replyText, processRes.error, {
      taskUpdates,
      conversationMetadata
    });
  } catch (error) {
    finishTaskUpdate(task.id, 'failed', null, error.message || String(error), {
      taskUpdates,
      conversationMetadata
    });
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
    const taskUpdates = {};
    const conversationMetadata = {};

    if (providerResult && typeof providerResult === 'object') {
      if (providerResult.providerSessionId) {
        taskUpdates.providerSessionId = providerResult.providerSessionId;
      }
      if (providerResult.providerParentMessageId) {
        taskUpdates.providerParentMessageId = providerResult.providerParentMessageId;
      }
      if (providerResult.providerMessageId) {
        taskUpdates.providerMessageId = providerResult.providerMessageId;
      }
      if (providerResult.endpointPath) {
        taskUpdates.providerEndpointPath = providerResult.endpointPath;
      }
      if (providerResult.requestId) {
        taskUpdates.providerRequestId = providerResult.requestId;
      }
      if (providerResult.responseMode) {
        taskUpdates.providerResponseMode = providerResult.responseMode;
      }

      if (
        providerResult.providerSessionId
        || providerResult.providerParentMessageId
        || providerResult.providerMessageId
        || providerResult.endpointPath
      ) {
        conversationMetadata.providerState = {
          provider: providerId,
          sessionId: providerResult.providerSessionId || null,
          parentMessageId: providerResult.providerParentMessageId || null,
          messageId: providerResult.providerMessageId || null,
          endpointPath: providerResult.endpointPath || null,
          requestId: providerResult.requestId || null,
          updatedAt: new Date().toISOString()
        };
      }
    }

    if (providerId === 'deepseek-web') {
      deepseekWebBusy = false;
    }
    await handleCompletedTaskResult(task, extractProviderResult(providerResult), {
      taskUpdates,
      conversationMetadata
    });
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
          if (status === 'completed') {
            handleCompletedTaskResult(task, result).catch((handlerError) => {
              finishTaskUpdate(taskId, 'failed', null, handlerError.message || String(handlerError));
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

// 导出主函数
const handlerExports = setupWebSocket;
handlerExports.broadcastToWeb = broadcastToWeb;
handlerExports.broadcastToExtensions = broadcastToExtensions;
handlerExports.triggerAssign = triggerAssign;

module.exports = handlerExports;
