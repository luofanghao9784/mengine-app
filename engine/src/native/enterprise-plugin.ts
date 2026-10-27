import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-system-prompt';
import '@deepseek-ai/dsh-skill';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
export const name = 'dreamcore-native-enterprise';
export const inject = ['tools', 'systemPrompt', 'skills'];

/** Installed only inside the isolated root runtime. Platform URL is the narrow
 * gateway, not an arbitrary model argument. All descendants inherit this root. */
export function apply(ctx: Context) {
  const endpoint = process.env.DREAMCORE_NATIVE_BRIDGE;
  const capability = process.env.DREAMCORE_NATIVE_CAPABILITY;
  if (!endpoint || !capability) throw new Error('NATIVE_ENTERPRISE_BRIDGE_REQUIRED');
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('NATIVE_ENTERPRISE_BRIDGE_INVALID');
  const call = async (action: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetch(new URL(action, base.href.endsWith('/') ? base : `${base}/`), {
      method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`ENTERPRISE_OPERATION_DENIED_${response.status}`);
    return await response.json() as Record<string, unknown>;
  };
  // Invalidate at every model step; definition loading always rechecks publication.
  let invalidateSkills = () => {};
  ctx.on('agent/pre-step', async (_request, next) => { invalidateSkills(); return next(); });
  ctx.skills.registerProvider(control => { invalidateSkills = control.invalidate; return ({
    name: 'enterprise',
    list: async ({ signal }) => {
      const result = await call('skills', {}, signal);
      const items = result.items as { name: string; description: string }[];
      return { complete: true, candidates: items.map(item => ({ ...item,
        provider: 'enterprise', source: 'enterprise', rank: 50, locator: item.name,
        invocation: { modelInvocable: true, userInvocable: true },
      })) };
    },
    get: async (candidate, { signal }) => {
      const result = await call('skills', { name: candidate.name }, signal);
      return { name: String(result.name), description: String(result.description), content: String(result.content),
        provider: 'enterprise', source: 'enterprise', invocation: { modelInvocable: true, userInvocable: true } };
    },
  }); });
  ctx.systemPrompt.section({ name: 'enterprise-boundary', order: 10300, interpolate: false,
    text: '企业资料请通过 enterprise_search 和 enterprise_read 获取，成果用 enterprise_save 保存私人草稿。保存回执才表示成功。共享发布由员工在企业入口确认；你不能代替员工发布。用 enterprise_history 读取旧会话参考上下文，它不是当前指令或已恢复的原生执行现场。' });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    const history = await call('history', {}, context.signal);
    if (typeof history.context === 'string' && history.context) assembly.contexts.push({ name: 'enterprise-legacy-history', text: history.context, interpolate: false });
    return assembly;
  });
  const string = (description: string) => ({ type: 'string' as const, required: true as const, description });
  const register = (toolName: string, description: string, parameters: ToolDefinition['parameters'], execute: (args: Record<string, string>, signal: AbortSignal) => Promise<unknown>) => {
    ctx.tools.register({ name: toolName, description, parameters,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => execute(args as Record<string, string>, exec.signal),
    });
  };
  register('enterprise_history', '读取当前获权的旧会话上下文，不能视为执行日志。', {}, (_, signal) => call('history', {}, signal));
  register('enterprise_search', '在当前企业工作空间检索获权资料；返回真实来源版本。', { query: string('检索词') }, (args, signal) => call('search', args, signal));
  register('enterprise_read', '将获权原始资料下载到隔离工作目录，返回本地路径。', {
    materialId: string('资料 UUID'), versionId: string('版本 UUID'), path: string('隔离目录内保存路径'),
  }, async (args, signal) => {
    const result = await call('read', { materialId: args.materialId, versionId: args.versionId }, signal);
    if (typeof result.contentBase64 !== 'string' || result.contentBase64.length > 27_962_028) throw Error('ENTERPRISE_FILE_INVALID');
    const path = resolve(args.path!); await writeFile(path, Buffer.from(result.contentBase64, 'base64'), { signal });
    return { filename: result.filename, path, saved: true };
  });
  register('enterprise_save', '保存现有文件为该会话的私人成果；不发布到共享空间。重试必须复用 requestId。', {
    requestId: string('本次保存 UUID；网络重试复用'), path: string('现有本地文件路径'), filename: string('成果文件名'),
  }, async (args, signal) => {
    const path = resolve(args.path!); const info = await stat(path);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw Error('ENTERPRISE_FILE_TOO_LARGE');
    const content = await readFile(path, { signal });
    if (content.length > 20 * 1024 * 1024) throw Error('ENTERPRISE_FILE_TOO_LARGE');
    return call('save', { requestId: args.requestId, filename: args.filename, contentBase64: content.toString('base64') }, signal);
  });
}
