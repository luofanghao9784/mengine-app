import { useEffect, useMemo, useState } from 'react';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { Button } from '../shared/ui';
import {
  preferenceClient,
  preferenceKeys,
  type PreferencePage,
  type PreferenceKey,
  type PreferenceScope,
} from './client';
import './preferences.css';
const names: Record<PreferenceKey, string> = {
  RESPONSE_LENGTH: '内容长短',
  RESPONSE_FORMAT: '正文形式',
  TONE: '表达语气',
  BRIEFING_ORDER: '画报顺序',
};
const labels: Record<string, string> = {
  CONCISE: '简洁',
  DETAILED: '详细',
  PARAGRAPHS: '自然段',
  BULLETS: '要点列表',
  DIRECT: '直接清楚',
  FRIENDLY: '友好自然',
  CONCLUSION_FIRST: '结论在前',
  EVIDENCE_FIRST: '依据在前',
};
const sources: Record<string, string> = {
  SYSTEM: '系统默认',
  GLOBAL: '总部设置',
  TENANT: '企业设置',
  PERSONAL: '个人设置',
};
export function ExpressionPreferencesPanel({ scope, tenant }: { scope: PreferenceScope; tenant?: string }) {
  const client = useMemo(() => preferenceClient(scope, tenant), [scope, tenant]);
  const [refresh, setRefresh] = useState(0),
    [saved, setSaved] = useState<PreferencePage>();
  const data = useRemote((signal) => client.read(signal), [client, refresh]);
  useEffect(() => setSaved(undefined), [data.value]);
  return (
    <section className="admin-section expression-preferences" aria-label="AI内容偏好">
      <header>
        <div>
          <h2>AI内容偏好</h2>
          <p className="muted">
            {scope === 'GLOBAL'
              ? '作为所有企业及用户的AI内容默认表达。'
              : scope === 'TENANT'
                ? '只影响本企业；未单独设置时继承总部偏好。'
                : '只影响本人在当前企业的AI内容；未单独设置时继承企业与总部偏好。'}
          </p>
        </div>
      </header>
      {data.error ? (
        <Failure
          error={data.error}
          retry={() => {
            setSaved(undefined);
            setRefresh((n) => n + 1);
          }}
        />
      ) : !data.value ? (
        <Loading />
      ) : (
        <PreferenceForm
          key={scope + tenant + refresh}
          page={saved ?? data.value}
          client={client}
          saved={setSaved}
        />
      )}
    </section>
  );
}
function PreferenceForm({
  page,
  client,
  saved,
}: {
  page: PreferencePage;
  client: ReturnType<typeof preferenceClient>;
  saved: (p: PreferencePage) => void;
}) {
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(preferenceKeys.map((k) => [k, page.settings[k].choice])) as Record<
        PreferenceKey,
        string
      >,
  );
  const [notice, setNotice] = useState('');
  const submission = useSubmission<{
    choices: Record<PreferenceKey, string>;
    expectedRevisions: Record<PreferenceKey, number>;
  }>();
  useRequestLock(submission.busy || submission.uncertain);
  const changed = preferenceKeys.some((k) => values[k] !== page.settings[k].choice);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submission.submit(
          {
            choices: values,
            expectedRevisions: Object.fromEntries(
              preferenceKeys.map((k) => [k, page.settings[k].revision]),
            ) as Record<PreferenceKey, number>,
          },
          async (body, id) => {
            const next = await client.save(body.choices, body.expectedRevisions, id);
            saved(next);
            setNotice('已保存。后续AI生成按有效偏好采用，已有内容保留。');
          },
        );
      }}
    >
      <div className="expression-preference-grid">
        {preferenceKeys.map((k) => (
          <label key={k}>
            <span>{names[k]}</span>
            <select
              aria-label={names[k]}
              disabled={!page.canMaintain || submission.busy || submission.uncertain}
              value={values[k]}
              onChange={(e) => {
                setNotice('');
                setValues((v) => ({ ...v, [k]: e.target.value }));
              }}
            >
              <option value="">{page.scope === 'GLOBAL' ? '使用系统默认' : '继承上层设置'}</option>
              {page.choices
                .filter((c) => c.category === k)
                .map((c) => (
                  <option key={c.choice} value={c.choice}>
                    {labels[c.choice]}
                  </option>
                ))}
            </select>
            <small>
              当前生效：{labels[page.effective[k].choice]} · {sources[page.effective[k].source]}
              {page.effective[k].revision > 0 ? ` v${page.effective[k].revision}` : ''}
            </small>
          </label>
        ))}
      </div>
      <p className="muted expression-preference-boundary">
        当前明确要求优先于默认偏好。偏好只调整表达，不改变事实、权限或业务数据；画报顺序只作用于画报。
      </p>
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      {notice && <p role="status">{notice}</p>}
      {page.canMaintain && (
        <div className="expression-preference-actions">
          <Button
            type="button"
            disabled={submission.busy || submission.uncertain}
            onClick={() => {
              setNotice('');
              setValues(
                Object.fromEntries(preferenceKeys.map((k) => [k, ''])) as Record<PreferenceKey, string>,
              );
            }}
          >
            全部恢复继承
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submission.busy || (!changed && !submission.uncertain)}
          >
            {submission.busy ? '保存中…' : submission.uncertain ? '核对并重试' : '保存偏好'}
          </Button>
        </div>
      )}
    </form>
  );
}
