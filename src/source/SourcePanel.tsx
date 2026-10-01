import { useRequestLock } from '../shared/request-guard';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, Download, Pencil, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import type { BusinessSource, SourceSettings, SourceSubmission } from '../../contracts/public-api/source';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { materialClient } from '../material/client';
import { Button, Badge, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { sourceClient as api, isDate } from './source-client';
import { SourceVersionPicker, type SourceVersion } from './SourceVersionPicker';
import './source.css';
const coverageLabel = {
  UNKNOWN: '未设预计覆盖日期',
  MISSING: '尚缺资料',
  GAP: '覆盖仍有缺口',
  DECLARED: '已声明覆盖',
};
const time = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
const period = (from: string | null, through: string | null) =>
  from && through ? `${from} 至 ${through}` : '未设定';
const denied = (error: unknown) => error instanceof IdentityError && [401, 403, 404].includes(error.status);
export function SourcePanel({
  tenant,
  workspace,
  workspaceName,
  verification,
  close,
}: {
  tenant: string;
  workspace: string;
  workspaceName: string;
  verification?: unknown;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useRequestLock(busy);
  return (
    <Modal
      title={`数据来源 · ${workspaceName}`}
      wide
      onClose={() => {
        if (!busy) close();
      }}
    >
      <SourceContents
        key={`${tenant}:${workspace}`}
        tenant={tenant}
        workspace={workspace}
        verification={verification}
        busy={busy}
        setBusy={setBusy}
      />
    </Modal>
  );
}
function SourceContents({
  tenant,
  workspace,
  verification,
  busy,
  setBusy,
}: {
  tenant: string;
  workspace: string;
  verification?: unknown;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const { session } = useSession();
  const account = session.identity!.account;
  const [mode, setMode] = useState<'list' | 'detail' | 'create' | 'edit' | 'submit'>(() =>
    new URLSearchParams(location.hash.slice(1)).has('source') ? 'detail' : 'list',
  );
  const [selected, setSelected] = useState<string | undefined>(
      () => new URLSearchParams(location.hash.slice(1)).get('source') || '',
    ),
    [draft, setDraft] = useState<BusinessSource>();
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState('');
  const [denial, setDenial] = useState<unknown>();
  const refresh = () => {
    setDenial(undefined);
    setAttempt((n) => n + 1);
  };
  const sources = useRemote(
    (signal) => api.list(tenant, workspace, page * 20, signal),
    [tenant, workspace, page, attempt, verification, session.identity],
  );
  const permission = useRemote(
    (signal) => materialClient.list(tenant, workspace, null, '', 0, signal),
    [tenant, workspace, attempt, verification, session.identity],
  );
  const detail = useRemote(
    (signal) => (selected ? api.get(tenant, workspace, selected, signal) : Promise.resolve(null)),
    [tenant, workspace, selected, attempt, verification, session.identity],
  );
  const canMaintain = !!permission.value?.canMaintain;
  const failure = denial || sources.error || permission.error || detail.error;
  const changed = (message: string, source?: BusinessSource) => {
    setNotice(message);
    if (source) setSelected(source.id);
    setDraft(undefined);
    setMode('detail');
    refresh();
  };
  const back = () => {
    setDraft(undefined);
    setMode(selected ? 'detail' : 'list');
    refresh();
  };
  const onDenied = (error: unknown) => {
    if (denied(error)) {
      setDenial(error);
      setDraft(undefined);
      setMode('list');
      setSelected(undefined);
    }
  };
  const person = (id: string) => (id === account.id ? `${account.displayName}（本人）` : `成员 ${id}`);
  useEffect(() => {
    if (permission.value && !permission.value.canMaintain && ['create', 'edit', 'submit'].includes(mode)) {
      setDraft(undefined);
      setMode(selected ? 'detail' : 'list');
      setNotice('维护权限已变化，当前仅可查看来源。');
    }
  }, [permission.value, mode, selected]);
  if (failure) return <Failure error={failure} retry={refresh} />;
  return (
    <section className="source-panel" aria-label="人工持续来源管理">
      <p className="source-intro">
        记录资料由谁提供、多久补交一次，以及应覆盖的业务日期。覆盖是人工声明，不代表资料已解析或内容质量已验证。
      </p>
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      <div className="source-toolbar">
        {mode !== 'list' && (
          <Button
            variant="ghost"
            icon={ArrowLeft}
            disabled={busy}
            onClick={() => {
              if (mode === 'detail') {
                setSelected(undefined);
                setMode('list');
                refresh();
              } else back();
            }}
          >
            {mode === 'detail' ? '返回来源列表' : '返回来源详情'}
          </Button>
        )}
        {mode === 'list' && (
          <Button icon={RefreshCw} disabled={busy} onClick={refresh}>
            刷新来源
          </Button>
        )}
        {mode === 'list' && canMaintain && (
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setSelected(undefined);
              setNotice('');
              setMode('create');
            }}
          >
            登记人工来源
          </Button>
        )}
      </div>
      {mode === 'create' || mode === 'edit' ? (
        <SourceForm
          key={draft?.id || 'new'}
          tenant={tenant}
          workspace={workspace}
          initial={draft}
          account={account}
          setBusy={setBusy}
          complete={(value) => changed('来源设置已保存。', value)}
          onDenied={onDenied}
        />
      ) : mode === 'submit' && (draft || detail.value) ? (
        <SubmissionForm
          tenant={tenant}
          workspace={workspace}
          source={(draft || detail.value)!}
          verification={verification}
          setBusy={setBusy}
          complete={() => changed('补交声明已保存；固定版本和覆盖日期可在下方核对。')}
          onDenied={onDenied}
        />
      ) : mode === 'detail' && selected ? (
        !detail.value ? (
          <Loading />
        ) : (
          <>
            <div className="source-detail-heading">
              <div>
                <h3>{detail.value.name}</h3>
                <Badge>{detail.value.status === 'ACTIVE' ? '使用中' : '已暂停'}</Badge>
              </div>
              {canMaintain && detail.value.canMaintain && (
                <div className="source-actions">
                  <Button
                    icon={Pencil}
                    onClick={() => {
                      setDraft(detail.value!);
                      setMode('edit');
                    }}
                  >
                    编辑来源
                  </Button>
                  <Button
                    variant="primary"
                    icon={Plus}
                    disabled={detail.value.status !== 'ACTIVE'}
                    onClick={() => {
                      setDraft(detail.value!);
                      setMode('submit');
                    }}
                  >
                    登记补交
                  </Button>
                </div>
              )}
            </div>
            <p className="source-description">{detail.value.description || '尚未填写来源说明。'}</p>
            <dl className="source-facts">
              <dt>负责人</dt>
              <dd>{person(detail.value.responsibleId)}</dd>
              <dt>补交周期</dt>
              <dd>{detail.value.cadenceHours ? `每 ${detail.value.cadenceHours} 小时` : '按需补交'}</dd>
              <dt>预计覆盖</dt>
              <dd>{period(detail.value.expectedFrom, detail.value.expectedThrough)}</dd>
              <dt>覆盖情况</dt>
              <dd>{coverageLabel[detail.value.coverageState]}</dd>
              <dt>最近有效补交</dt>
              <dd>{time(detail.value.lastSubmittedAt)}</dd>
              <dt>下次到期</dt>
              <dd>
                {detail.value.dueAt ? time(detail.value.dueAt) : '未设置周期'}
                {detail.value.overdue && <Badge>已逾期</Badge>}
              </dd>
            </dl>
            {detail.value.status === 'PAUSED' && (
              <p className="source-note">来源暂停期间不能登记新补交，已保存的资料和历史声明继续保留。</p>
            )}
            <p className="source-note">
              到期状态按当前预计覆盖要求计算；历史无关补交或本期覆盖仍不完整时，不会自动解除本期逾期。
            </p>
            <ConfigHistory
              tenant={tenant}
              workspace={workspace}
              source={detail.value}
              revision={attempt}
              verification={verification}
              person={person}
              onDenied={onDenied}
            />
            <SubmissionHistory
              tenant={tenant}
              workspace={workspace}
              source={detail.value}
              verification={verification}
              revision={attempt}
              person={person}
              setBusy={setBusy}
              canMaintain={canMaintain && detail.value.canMaintain}
              complete={() => changed('错误声明已撤回，关联原件保持不变。')}
              onDenied={onDenied}
            />
          </>
        )
      ) : !sources.value || !permission.value ? (
        <Loading />
      ) : (
        <>
          {!sources.value.items.length ? (
            <Empty
              icon={ClipboardList}
              title="还没有登记数据来源"
              text="可以登记定期提供的报表、人工台账或其他业务资料。只读成员可查看已登记来源。"
            />
          ) : (
            <ul className="source-list">
              {sources.value.items.map((source) => (
                <li key={source.id}>
                  <button
                    className="source-row"
                    onClick={() => {
                      setSelected(source.id);
                      setMode('detail');
                      setNotice('');
                    }}
                  >
                    <div className="source-row-title">
                      <strong>{source.name}</strong>
                      <Badge>{source.status === 'ACTIVE' ? '使用中' : '已暂停'}</Badge>
                    </div>
                    <p>{source.description || '人工提供的持续业务资料'}</p>
                    <div className="source-row-meta">
                      <span>{coverageLabel[source.coverageState]}</span>
                      <span>{source.cadenceHours ? `每 ${source.cadenceHours} 小时` : '按需补交'}</span>
                      {source.overdue && <Badge>已逾期</Badge>}
                    </div>
                    <small>负责人：{person(source.responsibleId)}</small>
                    <small>预计覆盖：{period(source.expectedFrom, source.expectedThrough)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pager page={page} next={sources.value.hasMore} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function SourceForm({
  tenant,
  workspace,
  initial,
  account,
  setBusy,
  complete,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  initial?: BusinessSource;
  account: { id: string; displayName: string };
  setBusy: (busy: boolean) => void;
  complete: (value: BusinessSource) => void;
  onDenied: (error: unknown) => void;
}) {
  const [name, setName] = useState(initial?.name || ''),
    [description, setDescription] = useState(initial?.description || '');
  const [responsible, setResponsible] = useState(initial?.responsibleId || account.id),
    [cadence, setCadence] = useState(initial?.cadenceHours?.toString() || '');
  const [from, setFrom] = useState(initial?.expectedFrom || ''),
    [through, setThrough] = useState(initial?.expectedThrough || '');
  const [status, setStatus] = useState<SourceSettings['status']>(initial?.status || 'ACTIVE'),
    [validation, setValidation] = useState('');
  const submission = useSubmission<{ settings: SourceSettings; expectedRevision?: number }>();
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    setBusy(submission.busy || submission.uncertain);
    return () => setBusy(false);
  }, [submission.busy, submission.uncertain, setBusy]);
  return (
    <form
      className="source-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !name.trim() ||
          ((from || through) && (!isDate(from) || !isDate(through) || from > through)) ||
          (cadence && (!/^\d+$/.test(cadence) || Number(cadence) < 1 || Number(cadence) > 8760))
        ) {
          setValidation('请填写来源名称；预计日期需成对填写且起日不晚于止日，周期为 1–8760 个整数小时。');
          return;
        }
        setValidation('');
        const settings: SourceSettings = {
          name: name.trim(),
          description: description.trim(),
          responsibleId: responsible,
          cadenceHours: cadence ? Number(cadence) : null,
          expectedFrom: from || null,
          expectedThrough: through || null,
          status,
        };
        void submission.submit(
          { settings, ...(initial ? { expectedRevision: initial.revision } : {}) },
          async (body, requestId) => {
            try {
              const result = initial
                ? await api.update(
                    tenant,
                    workspace,
                    initial.id,
                    { ...body, expectedRevision: body.expectedRevision!, requestId },
                    controller.current.signal,
                  )
                : await api.create(
                    tenant,
                    workspace,
                    { settings: body.settings, requestId },
                    controller.current.signal,
                  );
              if (!controller.current.signal.aborted) complete(result);
            } catch (error) {
              if (!controller.current.signal.aborted) onDenied(error);
              throw error;
            }
          },
        );
      }}
    >
      <h3>{initial ? '编辑来源' : '登记人工来源'}</h3>
      <fieldset disabled={submission.busy || submission.uncertain}>
        <Field label="来源名称">
          <input
            aria-label="来源名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            required
          />
        </Field>
        <Field label="来源说明">
          <textarea
            aria-label="来源说明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="例如：负责人每周从原系统导出并上传本周订单台账"
          />
        </Field>
        <Field label="负责人" hint="登记负责人不会新增空间权限；首版可由本人负责，或保留该来源的现有负责人。">
          <select
            aria-label="来源负责人"
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
          >
            {initial && initial.responsibleId !== account.id && (
              <option value={initial.responsibleId}>保留现有负责人 · {initial.responsibleId}</option>
            )}
            <option value={account.id}>{account.displayName}（本人）</option>
          </select>
        </Field>
        <div className="source-form-grid">
          <Field label="补交周期（小时）" hint="留空表示按需补交。">
            <input
              aria-label="补交周期（小时）"
              type="number"
              min={1}
              max={8760}
              step={1}
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              placeholder="例如 168"
            />
          </Field>
          <Field label="来源状态">
            <select
              aria-label="来源状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as SourceSettings['status'])}
            >
              <option value="ACTIVE">使用中</option>
              <option value="PAUSED">暂停</option>
            </select>
          </Field>
        </div>
        <div className="source-form-grid">
          <Field label="预计覆盖起日">
            <input
              aria-label="预计覆盖起日"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="预计覆盖止日">
            <input
              aria-label="预计覆盖止日"
              type="date"
              value={through}
              onChange={(e) => setThrough(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>
      {validation && (
        <p className="access-alert" role="alert">
          {validation}
        </p>
      )}
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      <Button type="submit" variant="primary" disabled={submission.busy}>
        {submission.busy ? '正在保存…' : submission.uncertain ? '重试本次来源保存' : '保存来源'}
      </Button>
    </form>
  );
}
function SubmissionForm({
  tenant,
  workspace,
  source,
  verification,
  setBusy,
  complete,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  source: BusinessSource;
  verification?: unknown;
  setBusy: (busy: boolean) => void;
  complete: () => void;
  onDenied: (error: unknown) => void;
}) {
  const [from, setFrom] = useState(source.expectedFrom || ''),
    [through, setThrough] = useState(source.expectedThrough || ''),
    [note, setNote] = useState(''),
    [versions, setVersions] = useState<SourceVersion[]>([]),
    [validation, setValidation] = useState('');
  const submission = useSubmission<{
    coverageFrom: string;
    coverageThrough: string;
    note: string;
    versionIds: string[];
  }>();
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    setBusy(submission.busy || submission.uncertain);
    return () => setBusy(false);
  }, [submission.busy, submission.uncertain, setBusy]);
  return (
    <form
      className="source-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDate(from) || !isDate(through) || from > through || !versions.length) {
          setValidation('请选择固定资料版本，并填写有效的覆盖起止日期。');
          return;
        }
        setValidation('');
        void submission.submit(
          {
            coverageFrom: from,
            coverageThrough: through,
            note: note.trim(),
            versionIds: versions.map((v) => v.versionId),
          },
          async (body, requestId) => {
            try {
              await api.submit(
                tenant,
                workspace,
                source.id,
                { ...body, requestId },
                controller.current.signal,
              );
              if (!controller.current.signal.aborted) complete();
            } catch (error) {
              if (!controller.current.signal.aborted) onDenied(error);
              throw error;
            }
          },
        );
      }}
    >
      <h3>登记补交 · {source.name}</h3>
      <fieldset disabled={submission.busy || submission.uncertain}>
        <div className="source-form-grid">
          <Field label="本次覆盖起日">
            <input
              aria-label="本次覆盖起日"
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="本次覆盖止日">
            <input
              aria-label="本次覆盖止日"
              type="date"
              required
              value={through}
              onChange={(e) => setThrough(e.target.value)}
            />
          </Field>
        </div>
        <Field label="补交说明">
          <textarea
            aria-label="补交说明"
            rows={2}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <SourceVersionPicker
          tenant={tenant}
          workspace={workspace}
          verification={verification}
          onDenied={onDenied}
          selected={versions}
          onChange={setVersions}
          disabled={submission.busy || submission.uncertain}
        />
      </fieldset>
      <p className="source-note">
        提交只记录这些固定版本被声明覆盖上述日期。不会自动判断资料是否齐全、正确或解析成功。
      </p>
      {validation && (
        <p className="access-alert" role="alert">
          {validation}
        </p>
      )}
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      <Button type="submit" variant="primary" disabled={submission.busy || !versions.length}>
        {submission.busy ? '正在登记…' : submission.uncertain ? '重试本次补交登记' : '确认补交声明'}
      </Button>
    </form>
  );
}
function SubmissionHistory({
  tenant,
  workspace,
  source,
  verification,
  revision,
  person,
  canMaintain,
  setBusy,
  complete,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  source: BusinessSource;
  verification?: unknown;
  revision: number;
  person: (id: string) => string;
  canMaintain: boolean;
  setBusy: (busy: boolean) => void;
  complete: () => void;
  onDenied: (error: unknown) => void;
}) {
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [withdraw, setWithdraw] = useState<SourceSubmission>();
  const [downloadError, setDownloadError] = useState<unknown>(),
    [downloading, setDownloading] = useState(false);
  const data = useRemote(
    (signal) => api.submissions(tenant, workspace, source.id, page * 20, signal),
    [tenant, workspace, source.id, page, attempt, revision, verification],
  );
  const submission = useSubmission<{ id: string; expectedRevision: number }>();
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    setBusy(submission.busy || submission.uncertain || downloading);
    return () => setBusy(false);
  }, [submission.busy, submission.uncertain, downloading, setBusy]);
  useEffect(() => {
    if (!canMaintain) setWithdraw(undefined);
  }, [canMaintain]);
  useEffect(() => {
    if (data.error && denied(data.error)) onDenied(data.error);
  }, [data.error, onDenied]);
  const download = async (version: SourceVersion) => {
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const blob = await materialClient.download(
        tenant,
        workspace,
        version.materialId,
        version.versionId,
        controller.current.signal,
      );
      if (controller.current.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = version.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.current.signal.aborted) {
        setDownloadError(error);
        onDenied(error);
      }
    } finally {
      if (!controller.current.signal.aborted) setDownloading(false);
    }
  };
  return (
    <section className="source-history" aria-label="来源补交历史">
      <h4>补交历史</h4>
      {!!downloadError && <SubmitError error={downloadError} uncertain={false} />}
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {!data.value.items.length ? (
            <p className="source-empty">尚无补交声明。上传文件后，可在此关联固定版本和覆盖日期。</p>
          ) : (
            <ul className="source-history-list">
              {data.value.items.map((item) => (
                <li key={item.id} className="source-history-item">
                  <header>
                    <strong>{period(item.coverageFrom, item.coverageThrough)}</strong>
                    <Badge>{item.status === 'ACTIVE' ? '有效声明' : '已撤回'}</Badge>
                  </header>
                  <small>
                    {person(item.submittedBy)} · {time(item.submittedAt)}
                  </small>
                  {item.note && <p>{item.note}</p>}
                  {item.unavailableVersions > 0 && (
                    <p role="status">
                      {item.unavailableVersions} 个依据版本已不可用，相关内容不参与覆盖判断。
                    </p>
                  )}
                  <ul className="source-history-versions">
                    {item.versions.map((version) => (
                      <li key={version.versionId}>
                        <div>
                          <strong>
                            {version.filename} · v{version.number}
                          </strong>
                          <details>
                            <summary>固定版本依据</summary>
                            <p>版本编号：{version.versionId}</p>
                            <p className="source-hash">SHA-256：{version.sha256}</p>
                          </details>
                        </div>
                        <Button
                          variant="ghost"
                          icon={Download}
                          disabled={downloading || submission.busy}
                          onClick={() => void download(version)}
                        >
                          下载 v{version.number}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {canMaintain && item.status === 'ACTIVE' && (
                    <Button
                      variant="ghost"
                      icon={RotateCcw}
                      disabled={submission.busy}
                      onClick={() => setWithdraw(item)}
                    >
                      撤回此声明
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
        </>
      )}
      {withdraw && canMaintain && (
        <div className="source-withdraw" role="alert">
          <p>
            撤回 {period(withdraw.coverageFrom, withdraw.coverageThrough)}{' '}
            的补交声明？原件和版本不会删除，覆盖情况将重新计算。
          </p>
          <SubmitError error={submission.error} uncertain={submission.uncertain} />
          <Button
            disabled={submission.busy}
            onClick={() =>
              void submission.submit(
                { id: withdraw.id, expectedRevision: withdraw.revision },
                async (body, requestId) => {
                  try {
                    await api.withdraw(
                      tenant,
                      workspace,
                      source.id,
                      body.id,
                      { expectedRevision: body.expectedRevision, requestId },
                      controller.current.signal,
                    );
                    if (!controller.current.signal.aborted) {
                      setWithdraw(undefined);
                      complete();
                    }
                  } catch (error) {
                    if (!controller.current.signal.aborted) onDenied(error);
                    throw error;
                  }
                },
              )
            }
          >
            {submission.uncertain ? '重试本次声明撤回' : '确认撤回声明'}
          </Button>
          <Button
            variant="ghost"
            disabled={submission.busy || submission.uncertain}
            onClick={() => setWithdraw(undefined)}
          >
            保留声明
          </Button>
        </div>
      )}
    </section>
  );
}

function ConfigHistory({
  tenant,
  workspace,
  source,
  revision,
  verification,
  person,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  source: BusinessSource;
  revision: number;
  verification?: unknown;
  person: (id: string) => string;
  onDenied: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => (open ? api.history(tenant, workspace, source.id, page * 20, signal) : Promise.resolve(null)),
    [tenant, workspace, source.id, open, page, attempt, revision, verification],
  );
  useEffect(() => {
    if (data.error && denied(data.error)) onDenied(data.error);
  }, [data.error, onDenied]);
  return (
    <section className="source-config-history" aria-label="来源配置历史">
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? '收起配置历史' : '查看配置历史'}
      </Button>
      {open &&
        (data.error ? (
          <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <ul className="source-history-list">
              {data.value.items.map((item) => (
                <li className="source-history-item" key={item.revision}>
                  <header>
                    <strong>
                      配置记录 r{item.revision} · {item.settings.name}
                    </strong>
                    <Badge>{item.settings.status === 'ACTIVE' ? '使用中' : '已暂停'}</Badge>
                  </header>
                  <small>
                    {person(item.changedBy)} · {time(item.effectiveAt)}
                  </small>
                  <p>{item.settings.description || '未填写说明'}</p>
                  <dl className="source-facts">
                    <dt>负责人</dt>
                    <dd>{person(item.settings.responsibleId)}</dd>
                    <dt>补交周期</dt>
                    <dd>
                      {item.settings.cadenceHours ? `每 ${item.settings.cadenceHours} 小时` : '按需补交'}
                    </dd>
                    <dt>预计覆盖</dt>
                    <dd>{period(item.settings.expectedFrom, item.settings.expectedThrough)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            {!data.value.items.length && <p className="source-empty">暂无可读取的配置历史。</p>}
            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          </>
        ))}
    </section>
  );
}
