const { parseActions } = require('./actions/action-parser');
const actionEngine = require('./actions/action-engine');
const systemPromptTemplate = require('./system-prompt/template');

module.exports = {
  processTask: (task) => {
    const options = task.options || {};
    const currentRound = task.round || 1;

    if (options.skipSystemInstruction) {
      return task.prompt;
    }

    if (currentRound > 1) {
      return task.prompt;
    }

    const systemInstruction = options.customSystemInstruction || systemPromptTemplate;
    
    return `${systemInstruction}\n\n---\n\n${task.prompt}`;
  },

  /**
   * 在收到 DeepSeek 回复后，处理结果并决定是否执行动作或继续多轮交互
   * 这个函数是 Agent 编排的核心
   * @param {Object} task 当前任务对象
   * @param {String} replyText DeepSeek 的原始回复文本
   * @param {Object} wsClients WebSocket 客户端集合，用于发送扩展指令
   * @returns {Promise<Object>} { status: 'completed'|'processing'|'failed', result: String, nextPrompt: String }
   */
  processResult: async (task, replyText, wsClients) => {
    try {
      // 1. 解析动作
      const actions = parseActions(replyText);
      
      if (!actions || actions.length === 0) {
        // 没有动作，任务直接完成
        return { status: 'completed', result: replyText };
      }

      // 多轮轮次限制 (默认最多 10 轮)
      const currentRound = task.round || 1;
      const maxRounds = task.options?.maxRounds || 10;
      
      if (currentRound >= maxRounds) {
        return { 
          status: 'completed', 
          result: `${replyText}\n\n[System] Reached maximum allowed rounds (${maxRounds}). Task terminated.` 
        };
      }

      // 2. 执行动作收集结果
      const actionResults = [];
      const extensionActions = []; // 需要交给 Chrome 扩展去执行的动作

      for (let i = 0; i < actions.length; i++) {
        // 限制单次最多执行 3 个动作，防止被滥用
        if (i >= 3) {
          actionResults.push({
            action: actions[i].action,
            success: false,
            error: 'Action skipped. Maximum of 3 actions per reply allowed.'
          });
          continue;
        }

        const result = await actionEngine.execute(task, actions[i]);
        
        // 如果是特殊类型：扩展动作，则需要发给扩展去执行
        if (result && result.type === 'extension_action') {
          extensionActions.push(result);
          actionResults.push({
            action: actions[i].action,
            success: true,
            result: 'Dispatched to browser extension for execution.'
          });
        } else {
          // 本地执行完毕
          actionResults.push({
            action: actions[i].action,
            success: result.success,
            result: result.result,
            error: result.error
          });
        }
      }

      // 3. 如果有需要发给扩展执行的动作（异步流程更复杂，目前简化处理）
      // 我们在此简单通过 WebSocket 派发，真实结果可能需要通过新的回调收。
      // 为简化当前流程，假设派发即成功，或直接交给扩展并在下一轮带回结果。
      if (extensionActions.length > 0 && wsClients && wsClients.extension) {
        for (const extAction of extensionActions) {
          wsClients.extension.send(JSON.stringify({
            type: 'execute_action',
            taskId: task.id,
            action: extAction.action,
            params: extAction.params
          }));
        }
      }

      // 4. 构造反馈消息给 DeepSeek，开启下一轮
      let feedbackPrompt = `<ActionResult>\n`;
      for (const res of actionResults) {
        feedbackPrompt += `Action: ${res.action}\n`;
        feedbackPrompt += `Status: ${res.success ? 'Success' : 'Failed'}\n`;
        if (res.success) {
          // 限制结果长度，防止 Token 爆掉
          const resultStr = JSON.stringify(res.result, null, 2);
          feedbackPrompt += `Result:\n\`\`\`json\n${resultStr.substring(0, 3000)}${resultStr.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
        } else {
          feedbackPrompt += `Error: ${res.error}\n`;
        }
        feedbackPrompt += `---\n`;
      }
      feedbackPrompt += `</ActionResult>\n\n请根据上述执行结果继续。`;

      // 递增轮次
      task.round = currentRound + 1;

      // 返回 processing 和 nextPrompt，告诉上层继续发起对话
      return { 
        status: 'processing', 
        nextPrompt: feedbackPrompt 
      };

    } catch (err) {
      console.error('[CustomHandler] Error processing result:', err);
      return { status: 'failed', error: err.message };
    }
  }
};

// [AutoEvolve Test] Loop executed at 2026-04-12T16:58:41.590Z