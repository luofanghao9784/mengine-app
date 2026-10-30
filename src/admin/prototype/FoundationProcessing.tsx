import { displayText, fieldLabel, recordLabel, versionLabel } from '../display-labels';
import { useEffect, useRef, useState } from 'react';
import { processingClient, type FoundationProcessing as Result } from './processing-client';
import { date } from './foundation-api';
import './processing-products.css';

export function FoundationProcessing({
  tenant,
  asset,
  updatedAt,
}: {
  tenant: string;
  asset: string;
  updatedAt: string;
}) {
  const [page, setPage] = useState(0),
    [attempt, refresh] = useState(0);
  const [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const revision = useRef<string | undefined>(undefined);
  const reset = () => {
    revision.current = undefined;
    setPage(0);
    refresh((n) => n + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    // Clear previous content before every request, including a page that loses permission.
    setData(null);
    setError('');
    setLoading(true);
    processingClient
      .read(tenant, asset, page * 20, revision.current, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        revision.current = value.revision;
        setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e.code === 'FOUNDATION_VERSION_CHANGED'
              ? '来源版本或解析结果已变化，请刷新处理结果后从第一页查看。'
              : e.status === 403 || e.status === 404
                ? '当前没有此来源的读取权限，或来源已撤下。'
                : '处理结果暂时无法读取，请重试。',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tenant, asset, page, attempt, updatedAt]);
  return (
    <section className="processing-products" aria-label="结构化处理结果">
      <div className="processing-products-heading">
        <h3>结构化处理结果</h3>
        <button onClick={reset}>刷新处理结果</button>
      </div>
      {loading ? (
        <p role="status">正在读取实际处理产物…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        data && (
          <>
            <p>
              来源{versionLabel(data.version)} · {data.recordCount} 条
              {data.recordKind === 'DOCUMENT_CHUNKS' ? '解析片段记录' : '结构化记录'} · {data.fields.length}{' '}
              个字段
            </p>
            {data.notes.map((note) => (
              <p className="product-note" key={displayText(note)}>
                {displayText(note)}
              </p>
            ))}
            <h4>具体字段 · {data.fields.length}</h4>
            {!data.fields.length ? (
              <p>尚未生成字段；解析完成后显示实际产物。</p>
            ) : (
              <div className="product-table-scroll" tabIndex={0} aria-label="结构化字段明细">
                <table>
                  <thead>
                    <tr>
                      <th>字段名称</th>
                      <th>类型</th>
                      <th>含义 / 单位</th>
                      <th>字段来源</th>
                      <th>依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fields.map((f) => (
                      <tr key={f.name}>
                        <th scope="row">
                          {fieldLabel(f.name)}
                        </th>
                        <td>{recordLabel(f.type)}</td>
                        <td>
                          {f.meaning}
                          {f.unit && <small>单位：{f.unit}</small>}
                        </td>
                        <td>{recordLabel(f.origin)}</td>
                        <td>{displayText(f.evidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4>结构化记录</h4>
            {!data.records.length ? (
              <p>当前页暂无已保存记录。</p>
            ) : data.recordKind === 'DATASET_ROWS' ? (
              <div className="product-table-scroll" tabIndex={0} aria-label="结构化记录表格">
                <table>
                  <thead>
                    <tr>
                      <th>序号</th>
                      {data.fields.map((f) => (
                        <th key={f.name}>{fieldLabel(f.name)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((row, index) => (
                      <tr key={index}>
                        <th scope="row">{data.offset + index + 1}</th>
                        {row.map((cell, i) => (
                          <td key={i}>{cell === null ? '空值' : cell === '' ? '空字符串' : cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="product-document-records">
                {data.records.map((row, index) => (
                  <details key={row[0] || index} open={index === 0}>
                    <summary>
                      记录 {data.offset + index + 1} · {displayText(row[2])} · {recordLabel(row[3])}
                    </summary>
                    <dl>
                      {data.fields.map((field, i) =>
                        field.name === 'content' ? null : (
                          <div key={field.name}>
                            <dt>{fieldLabel(field.name)}</dt>
                            <dd>{row[i]}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                    <p className="product-content">{row[4]}</p>
                  </details>
                ))}
              </div>
            )}
            <nav className="product-pages" aria-label="结构化记录分页">
              <button disabled={page === 0 || loading} onClick={() => setPage((n) => n - 1)}>
                上一页记录
              </button>
              <span>第 {page + 1} 页 · 每页最多 20 条</span>
              <button disabled={!data.hasMore || loading} onClick={() => setPage((n) => n + 1)}>
                下一页记录
              </button>
            </nav>

            <h4>处理阶段与产物</h4>
            <ol className="product-stages">
              {data.stages.map((stage) => (
                <li key={stage.key}>
                  <div>
                    <strong>{displayText(stage.name)}</strong>
                    <span>{recordLabel(stage.state)}</span>
                  </div>
                  <p>{displayText(stage.detail)}</p>
                  <small>{stage.at ? date(stage.at) : '尚无独立完成时间记录'}</small>
                  {!!stage.outputs.length && <p>产物：{stage.outputs.map(text => displayText(text)).join('；')}</p>}
                  {!!stage.fields.length && <p>涉及字段：{stage.fields.map(name => fieldLabel(name)).join('、')}</p>}
                </li>
              ))}
            </ol>
            <h4>已保存的处理批次</h4>
            {!data.history.length ? (
              <p>暂无独立处理批次记录。</p>
            ) : (
              <ul className="product-history">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <strong>
                      {displayText(h.stage)} · {recordLabel(h.state)}
                    </strong>
                    <p>{displayText(h.detail)}</p>
                    <small>
                      创建：{date(h.createdAt)} · 完成：{h.finishedAt ? date(h.finishedAt) : '尚无完成回执'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}
    </section>
  );
}
