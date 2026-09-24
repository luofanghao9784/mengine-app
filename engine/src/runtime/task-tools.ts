import { createHash } from 'node:crypto';
import { RuntimeError, type TaskTool } from './ports.js';
import type { TaskFile, TaskSandbox } from './sandbox.js';

/** Constructed by a trusted caller from already authorized copies, never from model-provided paths. */
export function createTaskTools(grant: {
  files: readonly TaskFile[];
  allowJavaScript: boolean;
  sandbox: TaskSandbox;
}): TaskTool[] {
  // Snapshot once: concurrent tasks cannot mutate each other's bytes through shared references.
  const files = grant.files.map((f) => ({ handle: f.handle, bytes: Uint8Array.from(f.bytes) }));
  if (
    files.length > 10 ||
    new Set(files.map((f) => f.handle)).size !== files.length ||
    files.some((f) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(f.handle)) ||
    files.reduce((n, f) => n + f.bytes.byteLength, 0) > 1048576
  )
    throw new RuntimeError('INVALID_FILE_GRANT');
  const tools: TaskTool[] = files.length
    ? [
        {
          name: 'read_input',
          description: `Read one granted UTF-8 input. Available handles: ${files.map((f) => f.handle).join(', ') || '(none)'}.`,
          parameters: {
            type: 'object',
            properties: { handle: { type: 'string', enum: files.map((f) => f.handle) } },
            required: ['handle'],
            additionalProperties: false,
          },
          async execute(args, signal) {
            signal.throwIfAborted();
            const file = files.find((f) => f.handle === (args as { handle?: unknown })?.handle);
            if (!file) throw new RuntimeError('INPUT_NOT_GRANTED');
            if (file.bytes.byteLength > 16384) throw new RuntimeError('TEXT_LIMIT');
            try {
              return {
                handle: file.handle,
                sha256: createHash('sha256').update(file.bytes).digest('hex'),
                text: new TextDecoder('utf-8', { fatal: true }).decode(file.bytes),
              };
            } catch {
              throw new RuntimeError('NOT_UTF8');
            }
          },
        },
      ]
    : [];
  if (grant.allowJavaScript === true)
    tools.push({
      name: 'run_javascript',
      description:
        'Run bounded JavaScript in a separate local sandbox. Read only granted files at ../inputs/<handle>; write at most 8 small regular output files in the working directory. No network, shell, packages, child processes or business writes. Returned artifacts are private task output, not published.',
      parameters: {
        type: 'object',
        properties: { script: { type: 'string' } },
        required: ['script'],
        additionalProperties: false,
      },
      async execute(args, signal) {
        const script = (args as { script?: unknown })?.script;
        if (typeof script !== 'string' || !script.trim() || Buffer.byteLength(script) > 16384)
          throw new RuntimeError('INVALID_SCRIPT');
        const result = await grant.sandbox.run(script, files, signal);
        return {
          stdout: result.stdout,
          artifacts: result.artifacts.map((f) => ({
            name: f.name,
            sha256: f.sha256,
            size: f.bytes.byteLength,
            contentBase64: Buffer.from(f.bytes).toString('base64'),
          })),
        };
      },
    });
  return tools;
}
