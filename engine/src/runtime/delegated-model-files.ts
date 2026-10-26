import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeError } from './ports.js';
import type { DelegatedModelExchange, DelegatedModelRequest, DelegatedModelResponse } from './delegated-model.js';

/** Private local transport; no HTTP listener, arbitrary paths, model fallback or execution of returned code. */
export class DelegatedModelFiles implements DelegatedModelExchange {
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new RuntimeError('INVALID_MODEL_INPUT');
  }
  async request(input: DelegatedModelRequest, signal: AbortSignal): Promise<DelegatedModelResponse> {
    signal.throwIfAborted();
    const root = await lstat(this.root);
    if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o777) !== 0o700 ||
        (process.getuid && root.uid !== process.getuid())) throw new RuntimeError('INVALID_MODEL_INPUT');
    if (!/^[0-9a-f-]{36}$/.test(input.id)) throw new RuntimeError('INVALID_MODEL_INPUT');
    const dir = join(this.root, input.id);
    await mkdir(dir, {mode:0o700});
    await writeFile(join(dir,'request.json'),JSON.stringify({...input,createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
    try {
      while (true) {
        signal.throwIfAborted();
        let file;
        try { file = await open(join(dir,'response.json'),constants.O_RDONLY | constants.O_NOFOLLOW); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new RuntimeError('INVALID_MODEL_RESPONSE'); }
        if (file) {
          try {
            const stat=await file.stat();
            if (!stat.isFile() || stat.size>65536 || (stat.mode & 0o077)!==0) throw new RuntimeError('INVALID_MODEL_RESPONSE');
            const response=JSON.parse(await file.readFile('utf8'));
            signal.throwIfAborted();
            await writeFile(join(dir,'transport-received.json'),JSON.stringify({receivedAt:new Date().toISOString(),id:input.id}),{mode:0o600,flag:'wx'});
            return response;
          } finally { await file.close(); }
        }
        await delay(100,undefined,{signal});
      }
    } catch(error) {
      await writeFile(join(dir,'closed.json'),JSON.stringify({id:input.id,state:signal.aborted?'CANCELLED':'FAILED'}),{mode:0o600,flag:'wx'});
      throw error;
    }
  }
}
