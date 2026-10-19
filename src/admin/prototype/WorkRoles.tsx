import { useEffect, useState } from 'react';
import { workRoles, type WorkRoles as Page, type WorkRole } from '../../identity/work-roles';
import './work-roles.css';
const labels: Record<string, string> = { OWNER: '企业负责人', ADMIN: '企业管理员', MEMBER: '工作人员' };
export function WorkRoles({ tenant }: { tenant: string }) {
  const [page, setPage] = useState<Page | null>(null),
    [selected, select] = useState('');
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
        const item = v.members.find((m) => m.accountId === selected) || v.members[0];
        if (item) {
          select(item.accountId);
          setDraft(item);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('岗位资料暂时无法读取，请重试。');
      });
    return () => controller.abort();
  }, [tenant, reload]);
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
    <section className="work-roles" aria-label="岗位与内容偏好">
      <h2>岗位与内容偏好</h2>
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
              disabled={saving}
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
                placeholder="例如：美容师、店长、财务"
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
            <legend>填写实际职责</legend>
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
            <button onClick={save}>{saving ? '正在保存…' : '保存岗位与关注方向'}</button>
          </fieldset>
          {!page.canMaintain && <p>岗位由企业负责人或管理员维护。如有调整，请联系他们确认。</p>}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
