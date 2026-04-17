const assert = require('assert');
const path = require('path');

process.env.WORKSPACE_ROOT = path.resolve(__dirname, '..');

const queueManager = require('./queue/manager');
const providerRegistry = require('./providers');
const wsHandler = require('./websocket/handler');

function createTask(id, prompt) {
  const timestamp = new Date().toISOString();
  return {
    id,
    prompt,
    options: {
      provider: 'deepseek-web',
      autoEvolve: true,
      maxRounds: 4
    },
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createQueueHarness(initialTask) {
  const tasks = new Map([[initialTask.id, { ...initialTask }]]);
  const pendingQueue = [initialTask.id];

  return {
    getTask(id) {
      return tasks.get(id) || null;
    },
    updateTask(id, updates) {
      const task = tasks.get(id);
      if (!task) {
        return null;
      }

      const updatedTask = {
        ...task,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      tasks.set(id, updatedTask);
      return updatedTask;
    },
    requeueTask(id, updates = {}) {
      const updatedTask = this.updateTask(id, {
        ...updates,
        status: 'pending'
      });

      if (updatedTask && !pendingQueue.includes(id)) {
        pendingQueue.push(id);
      }

      return updatedTask;
    },
    getNextPendingTask(predicate = null) {
      for (let index = 0; index < pendingQueue.length; index += 1) {
        const id = pendingQueue[index];
        const task = tasks.get(id);

        if (!task || task.status !== 'pending') {
          pendingQueue.splice(index, 1);
          index -= 1;
          continue;
        }

        if (typeof predicate === 'function' && !predicate(task)) {
          continue;
        }

        pendingQueue.splice(index, 1);
        return task;
      }

      return null;
    }
  };
}

function patchQueueManager(harness) {
  const originals = {
    getTask: queueManager.getTask,
    updateTask: queueManager.updateTask,
    requeueTask: queueManager.requeueTask,
    getNextPendingTask: queueManager.getNextPendingTask
  };

  queueManager.getTask = harness.getTask.bind(harness);
  queueManager.updateTask = harness.updateTask.bind(harness);
  queueManager.requeueTask = harness.requeueTask.bind(harness);
  queueManager.getNextPendingTask = harness.getNextPendingTask.bind(harness);

  return () => {
    queueManager.getTask = originals.getTask;
    queueManager.updateTask = originals.updateTask;
    queueManager.requeueTask = originals.requeueTask;
    queueManager.getNextPendingTask = originals.getNextPendingTask;
  };
}

function waitForTaskCompletion(harness, taskId, timeoutMs = 4000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const task = harness.getTask(taskId);
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        resolve(task);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for task ${taskId}`));
        return;
      }

      setTimeout(tick, 25);
    };

    tick();
  });
}

async function runContinuationScenario() {
  const task = createTask('deepseek-server-loop', 'Inspect the environment and continue.');
  const harness = createQueueHarness(task);
  const restoreQueue = patchQueueManager(harness);
  const originalExecuteTask = providerRegistry.executeTask;
  const providerCalls = [];

  try {
    providerRegistry.executeTask = async (executionTask) => {
      providerCalls.push({
        prompt: executionTask.prompt,
        providerSessionId: executionTask.providerSessionId || null,
        providerParentMessageId: executionTask.providerParentMessageId || null
      });

      if (providerCalls.length === 1) {
        return {
          text: '```action\n{"action":"get_system_info","params":{}}\n```',
          providerSessionId: 'session-1',
          providerParentMessageId: 'assistant-1',
          providerMessageId: 'assistant-1',
          endpointPath: '/api/chat',
          responseMode: 'json'
        };
      }

      assert.strictEqual(providerCalls.length, 2);
      assert.ok(executionTask.prompt.includes('<ActionResult>'));
      assert.ok(executionTask.prompt.includes('Action: get_system_info'));
      assert.strictEqual(executionTask.providerSessionId, 'session-1');
      assert.strictEqual(executionTask.providerParentMessageId, 'assistant-1');

      return {
        text: 'Final server-side answer',
        providerSessionId: 'session-1',
        providerParentMessageId: 'assistant-2',
        providerMessageId: 'assistant-2',
        endpointPath: '/api/chat',
        responseMode: 'json'
      };
    };

    wsHandler.triggerAssign();

    const finalTask = await waitForTaskCompletion(harness, task.id);
    assert.strictEqual(providerCalls.length, 2);
    assert.strictEqual(finalTask.status, 'completed');
    assert.strictEqual(finalTask.result, 'Final server-side answer');
    assert.strictEqual(finalTask.providerSessionId, 'session-1');
    assert.strictEqual(finalTask.providerParentMessageId, 'assistant-2');
    assert.strictEqual(finalTask.providerMessageId, 'assistant-2');
  } finally {
    providerRegistry.executeTask = originalExecuteTask;
    restoreQueue();
  }
}

async function runMissingExtensionScenario() {
  const task = createTask('deepseek-server-browser-action', 'Create a new browser session.');
  const harness = createQueueHarness(task);
  const restoreQueue = patchQueueManager(harness);
  const originalExecuteTask = providerRegistry.executeTask;
  let providerCallCount = 0;

  try {
    providerRegistry.executeTask = async () => {
      providerCallCount += 1;
      return {
        text: '```action\n{"action":"new_session","params":{}}\n```',
        providerSessionId: 'session-browser',
        providerParentMessageId: 'assistant-browser-1',
        providerMessageId: 'assistant-browser-1',
        endpointPath: '/api/chat',
        responseMode: 'json'
      };
    };

    wsHandler.triggerAssign();

    const finalTask = await waitForTaskCompletion(harness, task.id);
    assert.strictEqual(providerCallCount, 1);
    assert.strictEqual(finalTask.status, 'failed');
    assert.ok(finalTask.error.includes('no extension client is connected'));
  } finally {
    providerRegistry.executeTask = originalExecuteTask;
    restoreQueue();
  }
}

async function main() {
  await runContinuationScenario();
  await runMissingExtensionScenario();
  console.log('PASS test-deepseek-server-loop');
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
