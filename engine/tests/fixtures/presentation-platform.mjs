// Launched by the Java integration test: real Harness, real renderer, real platform callbacks.
import { writeFile } from 'node:fs/promises';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { PresentationRenderer } from '../../dist/runtime/presentation-renderer.js';
import { presentationModel } from './presentation.mjs';
const [platformBaseUrl, taskId, attemptId, sourceId, destination] = process.argv.slice(2);
const renderer = new PresentationRenderer();
await renderer.check();
const agent = new AgentTasks({
  platformBaseUrl,
  executionClass: 'live',
  modelName: 'synthetic-presentation-model',
  createModel: () => presentationModel(sourceId),
  presentationRenderer: renderer,
});
try {
  const result = await agent.run(
    { contractVersion: '1.5', taskId, attemptId, prompt: '请根据合成营收资料生成六页经营复盘PPT' },
    new AbortController().signal,
  );
  await writeFile(destination, JSON.stringify(result));
} finally {
  agent.stop();
}
