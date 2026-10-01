import { useEffect, useState } from 'react';
import type { KnowledgeChunk } from '../../contracts/public-api/knowledge';
import { useSession } from '../identity/session';
import { Button, Modal, Badge, Field } from '../shared/ui';
import { Failure, Loading, Pager, useRemote, useSubmission, SubmitError } from '../shared/admin';
import { knowledgeClient as api } from './knowledge-client';
import { IdentityError } from '../identity/client';
const statuses: Record<string, string> = {
  NOT_STARTED: '尚未解析',
  QUEUED: '等待解析',
  RUNNING: '正在解析',
  READY: '已提取文字',
  PARTIAL: '部分解析 · 请核对',
  FAILED: '解析未完成',
  UNSUPPORTED: '暂不支持此格式',
  CANCELLED: '权限变化，解析已取消',
};
const warnings: Record<string, string> = {
  OCR_REVIEW_REQUIRED: '文字来自 OCR，可能存在错字或数字识别错误，请核对原件。',
  PDF_LAYOUT_NOT_INTERPRETED: 'PDF 按页提取文字；图表、复杂布局和文字页内的图片内容未完整解读。',
  OFFICE_NON_BODY_CONTENT: '正文外的页眉页脚、图片或其他对象未完整提取。',
  FORMULAS_NOT_RECALCULATED: '公式未重新计算；仅展示文件中已有的缓存值。',
  FORMULA_VALUE_MISSING: '部分公式没有缓存值，不能据此确定计算结果。',
  XLS_CACHED_VALUES_ONLY: '旧版表格仅提取保存的值，不验证公式或执行宏。',
  ENCODING_GB18030: '已按 GB18030 编码读取，请核对文字。',
  CONTENT_LIMIT: '内容超过本轮提取上限。',
  PAGE_LIMIT: '本轮仅处理前 30 页。',
  RESOURCE_LIMIT: '达到本轮处理上限。',
  NO_TEXT_FOUND: '未提取到可检索文字。请检查文件是否为空，或换用更清晰的扫描件。',
  PARSE_FAILED: '文件解析失败。请确认原件能够正常打开、未加密且扩展名正确，再重新上传或重试。',
  PARSER_UNAVAILABLE_OR_LIMIT: '解析环境不可用或处理超限。',
  WORKER_RETRY_LIMIT: '任务恢复次数已达上限，可手动重试。',
  ACCESS_CHANGED: '请求人的维护权限已变化。',
};
function Fragment({ chunk }: { chunk: KnowledgeChunk }) {
  return (
    <article className="knowledge-fragment">
      <header>
        <strong>{chunk.locator}</strong>
        <Badge>{chunk.method === 'OCR' ? 'OCR' : chunk.method === 'TABLE' ? '表格' : '文字'}</Badge>
      </header>
      <pre>{chunk.content}</pre>
    </article>
  );
}
export function AnalysisPanel({
  tenant,
  space,
  material,
  version,
  verification,
}: {
  tenant: string;
  space: string;
  material: string;
  version: string;
  verification: unknown;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  const [denied, setDenied] = useState<unknown>();
  const submit = useSubmission<{ expectedGeneration: number }>();
  const data = useRemote(
    (signal) => api.analysis(tenant, space, material, version, page * 20, signal),
    [tenant, space, material, version, page, attempt, session.identity, verification],
  );
  const busy = data.value && ['QUEUED', 'RUNNING'].includes(data.value.status);
  useEffect(() => {
    if (busy) {
      const timer = setTimeout(() => setAttempt((x) => x + 1), 2000);
      return () => clearTimeout(timer);
    }
  }, [busy, attempt, data.value]);
  if (denied || data.error)
    return (
      <Failure
        error={denied || data.error}
        retry={() => {
          setDenied(undefined);
          setAttempt((x) => x + 1);
        }}
      />
    );
  if (!data.value) return <Loading />;
  const value = data.value;
  return (
    <section className="knowledge-analysis" aria-label="版本解析内容">
      <div className="material-section">
        <h3>{statuses[value.status]}</h3>
        {value.canMaintain && value.available && !busy && (
          <Button
            disabled={submit.busy}
            onClick={() =>
              void submit.submit({ expectedGeneration: value.generation }, async (body, requestId) => {
                try {
                  await api.parse(tenant, space, material, version, { ...body, requestId });
                  setPage(0);
                  setAttempt((x) => x + 1);
                } catch (error) {
                  if (error instanceof IdentityError && [401, 403, 404].includes(error.status))
                    setDenied(error);
                  throw error;
                }
              })
            }
          >
            {submit.uncertain ? '重试本次请求' : value.generation ? '重新解析' : '开始解析'}
          </Button>
        )}
      </div>
      {!value.available && <p className="muted">本地解析环境尚未启用，原件仍可下载。</p>}
      {value.status === 'FAILED' && <p className="muted">原件已保留，可下载检查；此版本尚无可检索内容。</p>}
      {value.status === 'UNSUPPORTED' && (
        <p className="muted">
          原件已保留，可下载使用。请转换为 PDF、DOCX、XLSX、XLS、CSV、TXT、Markdown 或 PNG/JPG
          后上传。当前资料库不会自动安装工具或转换此格式。
        </p>
      )}
      {value.warnings.map((w) => (
        <p className="knowledge-warning" key={w}>
          {warnings[w] || '此版本存在未完整提取的内容，请核对原件。'}
        </p>
      ))}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      {value.chunks.map((c) => (
        <Fragment key={c.id} chunk={c} />
      ))}
      {!!value.chunks.length && <Pager page={page} next={value.hasMore} onPage={setPage} />}
    </section>
  );
}
export function Citation({
  tenant,
  id,
  back,
  verification,
  embedded = false,
}: {
  tenant: string;
  id: string;
  back: () => void;
  verification: unknown;
  embedded?: boolean;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => api.citation(tenant, id, signal),
    [tenant, id, attempt, session.identity, verification],
  );
  return (
    <>
      {!embedded && <Button onClick={back}>返回检索</Button>}
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((x) => x + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {embedded ? (
            <details className="live-citation-properties">
              <summary>资料信息 · v{data.value.version}</summary>
              <p>{data.value.filename}</p>
              <p className="muted">
                引用固定在此文件版本和解析批次，后续更新不会覆盖这里的内容。以下为本次引用片段。
              </p>
            </details>
          ) : (
            <>
              <h3>
                {data.value.filename} · v{data.value.version}
              </h3>
              <p className="muted">引用固定在此文件版本和解析批次，后续更新不会覆盖这里的内容。</p>
            </>
          )}
          <Fragment chunk={data.value} />
        </>
      )}
    </>
  );
}
export function ContentSearch({
  tenant,
  space,
  close,
  verification,
}: {
  tenant: string;
  space: string | null;
  close: () => void;
  verification: unknown;
}) {
  const [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string>();
  return (
    <Modal title="搜索资料内容" onClose={close} wide>
      {selected ? (
        <Citation
          tenant={tenant}
          id={selected}
          back={() => setSelected(undefined)}
          verification={verification}
        />
      ) : (
        <>
          <p className="material-caption">
            {space ? '当前整个空间' : '已授权的企业共享空间'} ·
            按关键词匹配已解析的最新文件版本。原件尚未解析的内容不会出现在结果中。
          </p>
          <form
            className="knowledge-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(text.trim());
              setPage(0);
            }}
          >
            <Field label="内容关键词">
              <input
                required
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="例如：项目进度"
              />
            </Field>
            <Button type="submit" variant="primary">
              检索
            </Button>
          </form>
          {query && (
            <SearchResults
              key={query}
              tenant={tenant}
              space={space}
              query={query}
              page={page}
              onPage={setPage}
              select={setSelected}
              verification={verification}
            />
          )}
        </>
      )}
    </Modal>
  );
}
function SearchResults({
  tenant,
  space,
  query,
  page,
  onPage,
  select,
  verification,
}: {
  tenant: string;
  space: string | null;
  query: string;
  page: number;
  onPage: (n: number) => void;
  select: (id: string) => void;
  verification: unknown;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => api.search(tenant, space, query, page * 20, signal),
    [tenant, space, query, page, attempt, session.identity, verification],
  );
  return data.error ? (
    <Failure error={data.error} retry={() => setAttempt((x) => x + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <>
      {!data.value.items.length && (
        <p className="muted">没有找到可访问的匹配内容。可以换一个关键词，或在资料版本中查看解析状态。</p>
      )}
      {data.value.items.map((c) => (
        <button className="knowledge-result" key={c.id} onClick={() => select(c.id)}>
          <strong>
            {c.filename} · v{c.version}
          </strong>
          <small>
            {c.locator} · {c.method === 'OCR' ? 'OCR，需核对' : '查看来源'}
          </small>
          <span>{c.content.slice(0, 360)}</span>
        </button>
      ))}
      <Pager page={page} next={data.value.hasMore} onPage={onPage} />
    </>
  );
}
