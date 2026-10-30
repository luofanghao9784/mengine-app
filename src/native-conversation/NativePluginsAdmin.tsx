import { settingsLabel } from '../admin/display-labels';
import { useState } from 'react';
import { Puzzle, RefreshCw } from 'lucide-react';
import { Button } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { IdentityError } from '../identity/client';
import { nativeConversationClient as api } from './client';
import { useNativeAvailability } from './useNativeConversations';
import './native-conversation.css';

/** What each audited module does, in the admin's words (appendix H). Unknown ids show their own title. */
const descriptions: Record<string, string> = {
  'native-core': '隔离运行、身份核对、预算、事件记录与文件工具。这是基础保护，不能关闭。',
  'enterprise-data': 'AI 检索、读取员工有权阅读的企业资料，以及把结果保存为员工的私人成果。',
  'enterprise-skills': '企业上架的技能：员工可以用“/”调用，AI 也能按需加载。',
  office: '处理 Word、Excel、PPT 文件时使用的官方说明书。',
};

const message = (e: unknown) =>
  e instanceof IdentityError || e instanceof Error ? e.message : '操作未完成，请稍后重试。';

/**
 * 企业管理端“AI 能力”：只能开关部署方审核、随运行环境预装的模块，不能在线安装。
 * 切换会让正在运行的会话按新配置重建，进行中的一轮会被中断，会话记录保留。
 */
export function NativePluginsAdmin({ tenant }: { tenant: string }) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((signal) => api.adminPlugins(tenant, signal), [tenant, attempt]);
  const available = useNativeAvailability(tenant);
  const [pending, setPending] = useState<{ id: string; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => setAttempt((x) => x + 1);
  const apply = async () => {
    if (!pending || !data.value) return;
    setBusy(true);
    setError('');
    try {
      await api.togglePlugin(tenant, pending.id, pending.enabled, data.value.policy.revision);
      setPending(null);
      refresh();
    } catch (e) {
      // Someone else changed the switches: show their version before trying again.
      if (e instanceof IdentityError && e.code === 'NATIVE_PLUGIN_REVISION_CONFLICT') refresh();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-section native-plugins">
      <div className="admin-section-heading">
        <div>
          <h2>服务设置</h2>
          <p className="admin-note">
            这些模块由部署方审核后随运行环境预装，这里只能开关，不能安装新的。切换后，正在运行的 AI
            会按新设置重启，进行中的那一轮会被中断，会话记录保留。
          </p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </div>
      {!available && (
        <p className="native-schedule-reason">本企业的原生运行环境尚未开启，这里的设置会在开启后生效。</p>
      )}
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <ul className="native-plugin-list">
          {data.value.manifest.preinstalled.map((p) => {
            const on = !!data.value!.policy.enabled[p.id as keyof typeof data.value.policy.enabled];
            const asking = pending?.id === p.id;
            return (
              <li key={p.id} className="native-plugin">
                <span className="native-picker-icon">
                  <Puzzle size={16} aria-hidden="true" />
                </span>
                <div className="native-plugin-text">
                  <strong>{p.title}</strong>
                  <small>{descriptions[p.id] ?? ''}</small>
                  {asking && (
                    <div className="native-plugin-confirm">
                      <p>
                        {pending.enabled ? '开启' : '关闭'}“{p.title}”后，本企业正在运行的 AI
                        会重启，进行中的一轮会被中断。确定吗？
                      </p>
                      <div className="native-actions">
                        <Button
                          variant={pending.enabled ? 'primary' : 'danger'}
                          disabled={busy}
                          onClick={() => void apply()}
                        >
                          确认{pending.enabled ? '开启' : '关闭'}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {p.required ? (
                  <span className="native-plugin-required">必需</span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${p.title}：${on ? '已开启' : '已关闭'}`}
                    className="native-switch"
                    disabled={busy || asking}
                    onClick={() => {
                      setError('');
                      setPending({ id: p.id, enabled: !on });
                    }}
                  >
                    <span aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
      {data.value && <p className="admin-note">{settingsLabel(data.value.policy.revision)}</p>}
    </section>
  );
}
