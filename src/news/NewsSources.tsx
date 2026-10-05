import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, Field, Modal, Badge } from '../shared/ui';
import { useRemote, useSubmission, Failure, Loading, SubmitError } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { newsClient, type NewsSource } from './client';
export function NewsSources({ tenant }: { tenant?: string }) {
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<NewsSource | null | undefined>();
  const api = newsClient(tenant);
  const remote = useRemote((signal) => api.list(signal), [tenant, revision]);
  const submit = useSubmission<NewsSource>();
  useRequestLock(submit.busy || submit.uncertain);
  const choose = (s: NewsSource) =>
    void submit.submit(s, async () => {
      await api.select(s, !s.selected);
      setRevision((n) => n + 1);
    });
  return (
    <section className="admin-section news-source-directory">
      <header className="admin-section-heading">
        <div>
          <h2>{tenant ? '补充资讯来源' : '资讯来源目录'}</h2>
          <p className="muted">
            {tenant
              ? '资讯默认按关注主题联网查询。可选用这些网站补充内容，不选也不影响主题搜索。'
              : '维护公开来源及适用范围。启用来源不代表已完成真实采集验收。'}
          </p>
        </div>
        <div className="actions">
          <Button variant="ghost" icon={RefreshCw} onClick={() => setRevision((n) => n + 1)}>
            刷新
          </Button>
          {!tenant && (
            <Button icon={Plus} onClick={() => setEdit(null)}>
              添加来源
            </Button>
          )}
        </div>
      </header>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      {remote.error ? (
        <Failure error={remote.error} retry={() => setRevision((n) => n + 1)} />
      ) : !remote.value ? (
        <Loading />
      ) : remote.value.length === 0 ? (
        <p className="muted">暂无补充来源，资讯仍可按关注主题联网查询。</p>
      ) : (
        <ul className="tenant-rows">
          {remote.value.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <p className="muted">{[s.industry, s.region, s.format].filter(Boolean).join(' · ')}</p>
                <p className="muted">
                  {s.lastStatus
                    ? `最近任务：${s.lastStatus === 'SUCCEEDED' ? '完成' : s.lastStatus === 'FAILED' ? '失败' : '处理中'}${s.checkedAt ? ' · ' + new Date(s.checkedAt).toLocaleString('zh-CN') : ''}`
                    : '尚未验证采集'}
                </p>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  查看公开来源
                </a>
              </div>
              <div className="actions">
                <Badge>{s.enabled ? (tenant && s.selected ? '已选用' : '可选用') : '已停用'}</Badge>
                {tenant ? (
                  <Button
                    variant="secondary"
                    disabled={submit.busy || (!s.enabled && !s.selected)}
                    onClick={() => choose(s)}
                  >
                    {s.selected ? '取消选用' : '选用'}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setEdit(s)}>
                    编辑
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit !== undefined && (
        <SourceEditor
          source={edit}
          close={() => setEdit(undefined)}
          saved={() => {
            setEdit(undefined);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
function SourceEditor({
  source,
  close,
  saved,
}: {
  source: NewsSource | null;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(source?.name ?? ''),
    [url, setUrl] = useState(source?.url ?? ''),
    [industry, setIndustry] = useState(source?.industry ?? ''),
    [region, setRegion] = useState(source?.region ?? ''),
    [format, setFormat] = useState(source?.format ?? 'PAGE'),
    [enabled, setEnabled] = useState(source?.enabled ?? false);
  const submission = useSubmission<Parameters<ReturnType<typeof newsClient>['save']>[0]>();
  useRequestLock(submission.busy || submission.uncertain);
  return (
    <Modal title={source ? '编辑资讯来源' : '添加资讯来源'} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submission.submit(
            {
              id: source?.id ?? null,
              revision: source?.revision ?? 0,
              name,
              url,
              industry,
              region,
              format,
              enabled,
            },
            async (c, requestId) => {
              await newsClient().save({ ...c, id: c.id ?? requestId });
              saved();
            },
          );
        }}
      >
        <Field label="来源名称">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="公开网址">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://"
          />
        </Field>
        <Field label="来源形式">
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="PAGE">公开网页</option>
            <option value="RSS">RSS 订阅</option>
            <option value="ATOM">Atom 订阅</option>
          </select>
        </Field>
        <Field label="适用行业">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={120} />
        </Field>
        <Field label="适用地区">
          <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={120} />
        </Field>
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用来源
        </label>
        <SubmitError error={submission.error} uncertain={submission.uncertain} />
        <Button type="submit" disabled={submission.busy}>
          保存
        </Button>
      </form>
    </Modal>
  );
}
