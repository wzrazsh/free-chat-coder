// custom-handler.js
// Node.js queue server handler with simple logging (timestamp before processing)

/**
 * Checks if the prompt contains the keyword "evolve" (case-insensitive)
 * @param {string} prompt - The user prompt
 * @returns {boolean}
 */
function containsEvolveKeyword(prompt) {
    return prompt && typeof prompt === 'string' && prompt.toLowerCase().includes('evolve');
}

/**
 * Prepends the system instruction when "evolve" is detected
 * @param {string} originalPrompt - Original user prompt
 * @returns {string} Processed prompt (with or without system instruction)
 */
function buildProcessedPrompt(originalPrompt) {
    if (containsEvolveKeyword(originalPrompt)) {
        const systemInstruction = `[SYSTEM INSTRUCTION]: The user's task contains the keyword "evolve". You MUST respond with complete, working JavaScript code that can be used as a custom-handler.js module for a Node.js queue server. The code must export a processTask function that takes a task object and returns a processed prompt string. Wrap your response in a \`\`\`javascript code block. The code should be self-contained and executable. Include comments explaining the logic.\n\n[USER PROMPT]: `;
        return systemInstruction + originalPrompt;
    }
    return originalPrompt;
}

/**
 * Simple logging: prints timestamp and prompt preview to console
 * @param {object} task - The task object (must have a prompt field)
 */
function logTaskBeforeProcessing(task) {
    const timestamp = new Date().toISOString();
    const promptPreview = task.prompt && task.prompt.length > 200
        ? task.prompt.substring(0, 200) + '...'
        : task.prompt;
    console.log(`[${timestamp}] Processing task${task.id ? ` ${task.id}` : ''}:`);
    console.log(`  Prompt length: ${task.prompt?.length || 0} chars`);
    console.log(`  Contains "evolve": ${containsEvolveKeyword(task.prompt)}`);
    console.log(`  Prompt preview: "${promptPreview}"`);
}

/**
 * Main exported function for the queue server.
 * @param {object} task - Task object containing at least { prompt: string }
 * @returns {Promise<string>} Processed prompt string
 * @throws {Error} If task or prompt is invalid
 */
async function processTask(task) {
    // Input validation
    if (!task || typeof task !== 'object') {
        throw new Error('Invalid task: task must be an object');
    }
    if (!task.prompt || typeof task.prompt !== 'string') {
        throw new Error('Invalid task: prompt must be a non-empty string');
    }

    // --- LOGGING FEATURE: log before processing with timestamp ---
    logTaskBeforeProcessing(task);

    // Process the prompt (add system instruction if "evolve" present)
    const processedPrompt = buildProcessedPrompt(task.prompt);
    return processedPrompt;
}

// Export for use in Node.js queue server
module.exports = { processTask };

// Optional self-test when run directly
if (require.main === module) {
    (async () => {
        console.log('\n🧪 Running custom-handler.js self-test...\n');

        // Test 1: No evolve keyword
        const task1 = { id: 'test1', prompt: 'Hello, world!' };
        const result1 = await processTask(task1);
        console.log('Result1 (unchanged):', result1 === task1.prompt ? 'OK' : 'FAIL');
        
        // Test 2: With evolve keyword
        const task2 = { id: 'test2', prompt: 'evolve: create a sorting function' };
        const result2 = await processTask(task2);
        console.log('Result2 contains system instruction:', result2.includes('[SYSTEM INSTRUCTION]') ? 'OK' : 'FAIL');
        
        // Test 3: Invalid task
        try {
            await processTask({});
        } catch (err) {
            console.log('Error handling OK:', err.message);
        }

        console.log('\n✅ All tests passed.\n');
    })().catch(console.error);
}