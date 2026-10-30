import { versionLabel } from './display-labels';
import { WikiInsights } from './WikiInsights';
import { WikiGraphs } from './WikiGraphs';
import { WikiArticles } from './WikiArticles';
import { LearnSource, WikiDrafts, WikiDraftReader } from './WikiLearning';
import { useState } from 'react';
import { BookOpen, RefreshCw, Search } from 'lucide-react';
import type { MaterialProcessingItem } from '../../contracts/public-api/knowledge';
import { useSession } from '../identity/session';
import { knowledgeClient as api } from '../material/knowledge-client';
import { AnalysisPanel, Citation, processingStatusLabel } from '../material/Knowledge';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { Button, Field, Modal } from '../shared/ui';
import './wiki-sources.css';

export function WikiSources({ tenant }: { tenant: string }) {
  const { session } = useSession();
  return <Wiki key={tenant + ':' + session.identity?.account.id} tenant={tenant} />;
}
function Wiki({ tenant }: { tenant: string }) {
  const [mode, setMode] = useState<'sources' | 'content' | 'drafts' | 'articles' | 'graphs' | 'insights'>(
    'sources',
  );
  const [learning, selectLearning] = useState<string>();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [revision, refresh] = useState(0);
  const [source, selectSource] = useState<MaterialProcessingItem>();
  const [citation, selectCitation] = useState<string>();
  return (
    <section className="wiki-sources">
      <header className="wiki-heading">
        <div>
          <h2>从知识回到来源</h2>
          <p>阅读获权共享资料，按原文检索并追溯到具体文件版本。</p>
        </div>
        <BookOpen size={36} />
      </header>
      <p className="wiki-notice">
        当前展示资料原文与解析片段；可生成本人学习草稿，经明确确认后按来源范围共享。可分析已发布知识的关系与共同阅读推荐。解析内容可能不完整，识别出的文字需核对原件。
      </p>
      <div className="wiki-controls">
        <div role="tablist" aria-label="Wiki 阅读方式">
          {(['sources', 'content', 'drafts', 'articles', 'graphs', 'insights'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                setQuery('');
                setDraft('');
              }}
            >
              {value === 'sources'
                ? '资料来源'
                : value === 'content'
                  ? '原文检索'
                  : value === 'drafts'
                    ? '我的学习草稿'
                    : value === 'articles'
                      ? '共享知识'
                      : value === 'graphs'
                        ? '知识关系'
                        : '资料分析'}
            </button>
          ))}
        </div>
        <Button icon={RefreshCw} onClick={() => refresh((n) => n + 1)}>
          刷新 Wiki
        </Button>
      </div>
      {!['drafts', 'articles', 'graphs', 'insights'].includes(mode) && (
        <form
          className="wiki-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft.trim());
            refresh((n) => n + 1);
          }}
        >
          <Field label={mode === 'sources' ? '资料名称' : '原文关键词'}>
            <input
              value={draft}
              maxLength={160}
              required={mode === 'content'}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={mode === 'sources' ? '搜索资料名称' : '例如：交付 验收（最多 8 个关键词）'}
            />
          </Field>
          <Button type="submit" icon={Search}>
            检索
          </Button>
        </form>
      )}
      {mode === 'insights' ? (
        <WikiInsights tenant={tenant} revision={revision} />
      ) : mode === 'graphs' ? (
        <WikiGraphs tenant={tenant} revision={revision} />
      ) : mode === 'articles' ? (
        <WikiArticles tenant={tenant} revision={revision} />
      ) : mode === 'drafts' ? (
        <WikiDrafts tenant={tenant} revision={revision} select={selectLearning} />
      ) : mode === 'sources' ? (
        <Sources key={query} tenant={tenant} query={query} revision={revision} select={selectSource} />
      ) : query ? (
        <Matches key={query} tenant={tenant} query={query} revision={revision} select={selectCitation} />
      ) : (
        <p className="wiki-empty">输入关键词，检索当前可读取的共享资料最新版本。</p>
      )}
      {source && (
        <Modal title="资料来源阅读" wide onClose={() => selectSource(undefined)}>
          <SourceReader tenant={tenant} source={source} revision={revision} />
          <LearnSource
            tenant={tenant}
            source={source}
            onCreated={(id) => {
              selectSource(undefined);
              selectLearning(id);
              setMode('drafts');
              refresh((n) => n + 1);
            }}
          />
        </Modal>
      )}
      {learning && (
        <WikiDraftReader
          key={learning}
          tenant={tenant}
          id={learning}
          close={() => selectLearning(undefined)}
        />
      )}
      {citation && (
        <Modal title="原文引用与来源" wide onClose={() => selectCitation(undefined)}>
          <Citation
            tenant={tenant}
            id={citation}
            back={() => selectCitation(undefined)}
            verification={revision}
          />
          <p className="wiki-notice">
            引用固定在检索时的文件版本与解析批次，不随新版本改写。每次读取重新核对当前权限。
          </p>
        </Modal>
      )}
    </section>
  );
}
// Fetch the version again before displaying a cached list item's title or text.
function SourceReader({
  tenant,
  source,
  revision,
}: {
  tenant: string;
  source: MaterialProcessingItem;
  revision: number;
}) {
  return (
    <AnalysisPanel
      tenant={tenant}
      space={source.workspaceId}
      material={source.materialId}
      version={source.versionId}
      verification={revision}
    />
  );
}
function Sources({
  tenant,
  query,
  revision,
  select,
}: {
  tenant: string;
  query: string;
  revision: number;
  select: (item: MaterialProcessingItem) => void;
}) {
  const { session } = useSession();
  const [page, setPage] = useState(0);
  const [attempt, retry] = useState(0);
  const data = useRemote(
    (signal) => api.processing(tenant, null, query, 'ALL', page * 20, signal),
    [tenant, query, revision, page, attempt, session.identity],
  );
  if (data.error) return <Failure error={data.error} retry={() => retry((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  return (
    <>
      <p className="muted">仅当前获权的共享资料 · 未解析资料仍保留在来源目录</p>
      <div className="wiki-grid">
        {data.value.items.map((item) => (
          <button className="wiki-card" key={item.materialId} onClick={() => select(item)}>
            <BookOpen size={20} />
            <h3>{item.name}</h3>
            <p>
              {item.workspaceName} · {versionLabel(item.version)}
            </p>
            <span>{processingStatusLabel[item.status]}</span>
            <small>阅读来源 →</small>
          </button>
        ))}
      </div>
      {!data.value.items.length && <p className="wiki-empty">暂无可访问的匹配资料。</p>}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
function Matches({
  tenant,
  query,
  revision,
  select,
}: {
  tenant: string;
  query: string;
  revision: number;
  select: (id: string) => void;
}) {
  const { session } = useSession();
  const [page, setPage] = useState(0);
  const [attempt, retry] = useState(0);
  const data = useRemote(
    (signal) => api.search(tenant, null, query, page * 20, signal),
    [tenant, query, revision, page, attempt, session.identity],
  );
  if (data.error) return <Failure error={data.error} retry={() => retry((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  return (
    <>
      <p className="muted">按关键词匹配原文片段；无匹配不代表全部资料均已解析，也不代表资料不相关。</p>
      {data.value.items.map((chunk) => (
        <button className="wiki-match" key={chunk.id} onClick={() => select(chunk.id)}>
          <strong>
            {chunk.filename} · {versionLabel(chunk.version)}
          </strong>
          <small>
            {chunk.locator} ·{' '}
            {chunk.method === 'OCR' ? '识别文字，需核对' : chunk.method === 'TABLE' ? '表格片段' : '文字片段'}
          </small>
          <p>{chunk.content.slice(0, 360)}</p>
          <span>追溯原文 →</span>
        </button>
      ))}
      {!data.value.items.length && <p className="wiki-empty">没有找到可访问的匹配原文。</p>}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
