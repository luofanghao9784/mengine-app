import { parentPort, workerData } from 'node:worker_threads';
import { renderPresentation } from './presentation-render.js';
try {
  const bytes = await renderPresentation(workerData.spec, workerData.references);
  parentPort!.postMessage(bytes, [bytes.buffer as ArrayBuffer]);
} catch {
  parentPort!.postMessage({ error: 'PRESENTATION_RENDER_FAILED' });
}
