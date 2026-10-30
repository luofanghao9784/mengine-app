import { useEffect, useState } from 'react';
import { workRoles, type WorkRoles as Page, type WorkRole } from '../../identity/work-roles';
import './work-roles.css';
const labels: Record<string, string> = { OWNER: '企业负责人', ADMIN: '企业管理员', MEMBER: '工作人员' };
export function WorkRoles({ tenant, account }: { tenant: string; account?: string }) {
  const [page, setPage] = useState<Page | null>(null),
    [selected, select] = useState(account || '');
  const [draft, setDraft] = useState<WorkRole | null>(null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState('');
  const [reload, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setDraft(null);
    setError('');
    workRoles
      .list(tenant, controller.signal)
      .then((v) => {
        if (controller.signal.aborted) return;
        setPage(v);
        const item = v.members.find((m) => m.accountId === (account || selected)) || (!account ? v.members[0] : undefined);
        if (item) {
          select(item.accountId);
          setDraft(item);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('岗位资料暂时无法读取，请重试。');
      });
    return () => controller.abort();
  }, [tenant, account, reload]);
  const save = async () => {
    if (!draft || !page?.canMaintain || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const value = await workRoles.save(tenant, draft, crypto.randomUUID());
      setDraft(value);
      setPage(
        (p) => p && { ...p, members: p.members.map((m) => (m.accountId === value.accountId ? value : m)) },
      );
      setNotice('岗位已保存。下一次会话和新画报会按这些职责安排重点；旧岗位的自动画报不再推荐。');
    } catch (e) {
      setError(
        (e as { code?: string }).code === 'WORK_ROLE_CHANGED'
          ? '岗位已被修改，请刷新后重新核对。'
          : '保存失败，请核对权限和填写内容后重试。',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="work-roles" aria-label="成员背景与治理目标">
      <h2>成员背景与治理目标</h2>
      <p>
        结合企业背景，为每个人安排适合其工作的提问建议和画报。岗位资料只影响内容重点；能看哪些资料，仍按已有权限决定。
      </p>
      <p>
        负责人默认关注经营、收支、客户和团队；管理员默认关注人员协作与风险；具体岗位可在这里补充。私人会话仍只供本人查看。
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button disabled={saving} onClick={() => refresh((n) => n + 1)}>
            刷新
          </button>
        </p>
      )}
      {!page && !error && <p role="status">正在读取岗位资料…</p>}
      {page && draft && (
        <>
          <label>
            成员
            <select
              aria-label="岗位成员"
              disabled={saving || !!account}
              value={draft.accountId}
              onChange={(e) => {
                const m = page.members.find((x) => x.accountId === e.target.value);
                if (m) {
                  select(m.accountId);
                  setDraft(m);
                  setNotice('');
                  setError('');
                }
              }}
            >
              {page.members.map((m) => (
                <option key={m.accountId} value={m.accountId}>
                  {m.name} · {labels[m.systemRole]}
                </option>
              ))}
            </select>
          </label>
          <p>账号身份：{labels[draft.systemRole]}。这里填写的岗位名称不会改变账号身份或访问权限。</p>
          <fieldset disabled={!page.canMaintain || saving}>
            <label>
              部门
              <input
                value={draft.department}
                maxLength={100}
                placeholder="例如：门店服务"
                onChange={(e) => setDraft({ ...draft, department: e.target.value })}
              />
            </label>
            <label>
              岗位
              <input
                value={draft.jobTitle}
                maxLength={100}
                placeholder="例如：美容师、前台、财务"
                onChange={(e) => setDraft({ ...draft, jobTitle: e.target.value })}
              />
            </label>
            <label>
              主要职责
              <textarea
                value={draft.responsibilities}
                maxLength={1200}
                rows={4}
                placeholder="说明平时负责什么、能处理什么、哪些事情需要向负责人确认。"
                onChange={(e) => setDraft({ ...draft, responsibilities: e.target.value })}
              />
            </label>
            <h3>治理目标</h3>
            <p>持续目标决定长期关注什么；阶段目标明确近期重点。没有确认的指标、期限和异常阈值请留空，不会因此扩大资料权限。</p>
            {([['governance','长期治理目标','例如：推进对账、跟进异常、形成财务汇报。'],['stage','当前阶段目标','例如：本期优先核查的事项；未确认期限不填写。'],['formalReporting','正式汇报关系','填写已确认的岗位汇报关系；未确认的人名不推定。'],['handoff','本轮接续人','说明本轮事项交给谁，不替代正式上级。'],['followUp','检查与协作方式','说明如何检查进展和协作。'],['indicators','已确认指标、期限与阈值','未确认请留空。'],['source','职责与目标依据','区分员工手册职责、用户确认和据职责制定的目标。']] as const).map(([key,label,hint]) => (
              <label key={key}>{label}<textarea rows={3} maxLength={1200} placeholder={hint} value={draft.goals?.[key] ?? ''} onChange={e=>setDraft({...draft,goals:{governance:'',stage:'',followUp:'',...draft.goals,[key]:e.target.value}})} /></label>
            ))}
            <legend>填写成员背景</legend>
            <p>关注方向（不选时先按岗位职责匹配，再使用身份默认方向）</p>
            <div className="work-focuses">
              {page.choices.map((f) => (
                <label key={f.key}>
                  <input
                    type="checkbox"
                    checked={draft.focus.includes(f.key)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        focus: e.target.checked
                          ? [...draft.focus, f.key]
                          : draft.focus.filter((k) => k !== f.key),
                      })
                    }
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <button onClick={save}>{saving ? '正在保存…' : '保存成员背景与目标'}</button>
          </fieldset>
          {!page.canMaintain && <p>岗位由企业负责人或管理员维护。如有调整，请联系他们确认。</p>}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
