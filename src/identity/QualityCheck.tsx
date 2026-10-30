import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Loading } from '../shared/admin';
import { openedCapabilitiesFailureTitle, type OpenedCapabilitiesState } from '../admin/openedCapabilities.ts';
import { Button, Empty, Field } from '../shared/ui';
import {
  qualityCheckFailureMessage,
  qualityCheckNotOpened,
  submitQualityCheck,
  type QualityCheckResult,
} from './quality-check-client.ts';
import { qualityCheckInputState } from './quality-check-input.ts';
import './quality-check.css';

export const qualityCheckHref = (tenant: string) =>
  `#tenant=${encodeURIComponent(tenant)}&view=quality-check`;

type Submission =
  | { state: 'idle' | 'submitting' }
  | { state: 'success'; value: QualityCheckResult }
  | { state: 'failure'; message: string };

export function QualityCheck({ opened }: { opened: OpenedCapabilitiesState }) {
  const [materialText, setMaterialText] = useState('');
  const [title, setTitle] = useState('');
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const enabled = !opened.error && opened.items?.some((item) => item.enterpriseFunction === 'quality-check');
  const { materialLength, titleLength, valid } = qualityCheckInputState(materialText, title);
  const submitting = submission.state === 'submitting';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || !valid || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSubmission({ state: 'submitting' });
    try {
      const value = await submitQualityCheck(materialText, title, controller.signal);
      if (!controller.signal.aborted) setSubmission({ state: 'success', value });
    } catch (error) {
      if (!controller.signal.aborted)
        setSubmission({ state: 'failure', message: qualityCheckFailureMessage(error) });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  if (opened.error)
    return (
      <Empty
        icon={ClipboardCheck}
        title={openedCapabilitiesFailureTitle(opened.error)}
        text="开通信息暂时无法读取，请稍后刷新重试。"
      />
    );
  if (!opened.items) return <Loading />;
  if (!opened.items.some((item) => item.enterpriseFunction === 'quality-check'))
    return (
      <Empty
        icon={ClipboardCheck}
        title={qualityCheckNotOpened}
        text="请联系企业管理员确认，开通后可以在这里提交检查材料。"
      />
    );
  return (
    <div className="quality-check">
      <section className="access-panel" aria-labelledby="quality-check-intro">
        <h2 id="quality-check-intro">① 进入说明</h2>
        <p>按约定规则提取问题行，提交后在下方查看本次结果。刷新页面后，本次结果不会保留。</p>
        <p id="quality-check-scope">
          仅识别以“问题：”或“问题:”开头且冒号后有非空内容的行，其他文字不在识别范围内。例如：问题：尺寸超差。此功能不做全文质量检查。
        </p>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-submit">
        <h2 id="quality-check-submit">② 提交检查材料</h2>
        <form onSubmit={submit} aria-busy={submitting}>
          <Field label="标题（选填）" hint={`${titleLength} / 200 字`}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={submitting} />
          </Field>
          <Field label="检查材料">
            <textarea
              value={materialText}
              onChange={(event) => setMaterialText(event.target.value)}
              rows={8}
              disabled={submitting}
              aria-describedby="quality-check-scope quality-check-count quality-check-count-rule"
              aria-invalid={materialLength > 20_000}
            />
          </Field>
          <p id="quality-check-count-rule">
            首尾普通空格、换行不计，文中空白及不换行空格计入。单个补充字符计 1
            字，组合表情可能计多字；标题使用相同规则。
          </p>
          <p id="quality-check-count">{materialLength} / 20000 字</p>
          {materialLength > 20_000 && <p role="alert">检查材料不能超过 20000 字</p>}
          {titleLength > 200 && <p role="alert">标题不能超过 200 字</p>}
          <Button type="submit" disabled={!valid || submitting}>
            {submitting ? '提交中…' : '提交检查材料'}
          </Button>
        </form>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-results">
        <h2 id="quality-check-results">③ 处理结果</h2>
        <div aria-live="polite" aria-atomic="true">
          {submission.state === 'idle' && <p>提交材料后，这里会显示本次处理结果。</p>}
          {submitting && <p role="status">提交中，请稍候…</p>}
          {submission.state === 'failure' && <p role="alert">{submission.message}</p>}
          {submission.state === 'success' && (
            <>
              <p>
                {submission.value.result.verdict === 'NO_ISSUES'
                  ? '本次未提取到符合约定规则的问题行，不代表全文没有质量问题'
                  : `发现 ${submission.value.result.issues.length} 处需要注意`}
              </p>
              {submission.value.result.issues.length > 0 && (
                <ol>
                  {submission.value.result.issues.map((issue, index) => (
                    <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {issue.message}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
