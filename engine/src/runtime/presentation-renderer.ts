import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { RuntimeError } from './ports.js';
import { parseDeck, type DeckSpec } from './presentation-spec.js';
import { PRESENTATION_RECIPE } from './presentation-render.js';
export type PresentationFile = { name: string; sha256: string; bytes: Uint8Array };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Trusted, fixed program in a bounded worker. No model-generated code and no paths/URLs in the contract. */
export class PresentationRenderer {
  private active = 0;
  async check() {
    await this.render(
      { title: '就绪检查', theme: 'ocean', slides: [{ kind: 'cover', title: '就绪检查', sourceIds: [] }] },
      {},
      new AbortController().signal,
    );
  }
  async render(
    input: unknown,
    references: Record<string, string>,
    signal: AbortSignal,
  ): Promise<PresentationFile[]> {
    const spec = parseDeck(input);
    if (signal.aborted) throw new RuntimeError('CANCELLED');
    if (this.active >= 2) throw new RuntimeError('PRESENTATION_BUSY');
    this.active++;
    try {
      const bytes = await this.worker(spec, references, signal);
      if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024)
        throw new RuntimeError('PRESENTATION_OUTPUT_LIMIT');
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
      if (
        !zip.file('[Content_Types].xml') ||
        !zip.file('ppt/presentation.xml') ||
        Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length !==
          spec.slides.length ||
        Object.keys(zip.files).length > 2000
      )
        throw new RuntimeError('INVALID_PRESENTATION_OUTPUT');
      for (const [path, file] of Object.entries(zip.files)) {
        if (
          path.startsWith('/') ||
          path.split('/').includes('..') ||
          /vbaProject|embeddings\/.*\.(exe|bin)$/i.test(path)
        )
          throw new RuntimeError('INVALID_PRESENTATION_OUTPUT');
        if (path.endsWith('.rels') && /TargetMode="External"/.test(await file.async('string')))
          throw new RuntimeError('INVALID_PRESENTATION_OUTPUT');
      }
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      const source = Buffer.from(
        JSON.stringify(
          { recipe: PRESENTATION_RECIPE, renderer: 'pptxgenjs@4.0.1', ...spec, references },
          null,
          2,
        ),
      );
      return [
        { name: 'presentation.pptx', bytes, sha256: digest(bytes) },
        { name: 'presentation-source.json', bytes: source, sha256: digest(source) },
      ];
    } finally {
      this.active--;
    }
  }
  private worker(
    spec: DeckSpec,
    references: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./presentation-worker.js', import.meta.url), {
        workerData: { spec, references },
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
      let settled = false;
      const finish = (error?: RuntimeError, value?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        void worker.terminate();
        error ? reject(error) : resolve(value!);
      };
      const cancel = () => finish(new RuntimeError('CANCELLED'));
      const timer = setTimeout(() => finish(new RuntimeError('PRESENTATION_TIMEOUT')), 8000);
      signal.addEventListener('abort', cancel, { once: true });
      worker.once('message', (value) =>
        value instanceof Uint8Array
          ? finish(undefined, value)
          : finish(new RuntimeError('PRESENTATION_RENDER_FAILED')),
      );
      worker.once('error', () => finish(new RuntimeError('PRESENTATION_RENDER_FAILED')));
      worker.once('exit', () => {
        if (!settled) finish(new RuntimeError('PRESENTATION_RENDER_FAILED'));
      });
      if (signal.aborted) cancel();
    });
  }
}
