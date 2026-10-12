import { useEffect, useRef, useState } from 'react';
import { stats, type Item, type Tone } from './data';
import { runs, steps, STEP_NAMES, tabs } from './content';
import { GATE_OF, GATES } from './world';

/**
 * 数据基座的卡片：治理 / 接入 / 目录三栏。
 * 管理员在这里只有四种操作（暂不提供给 AI、确认可以提供、重试解析、立即取数），都能在清单行上一步完成；
 * 口径和取数频率由部署方确定，这里只读。
 */
type Act = { label: string; done: string; quiet?: boolean };
const HOLD: Act = { label: '暂不提供给 AI', done: '已暂不提供给 AI' },
  ALLOW: Act = { label: '确认可以提供', done: '已确认，可以提供给 AI', quiet: true },
  FETCH: Act = { label: '立即取数', done: '已开始取数' },
  RETRY: Act = { label: '重试解析', done: '已重新排队解析' };
const ACTS: Record<string, Act[]> = {
  d2: [HOLD, ALLOW],
  d3: [HOLD, ALLOW],
  d4: [FETCH],
  d5: [RETRY],
  s1: [FETCH],
  s2: [FETCH],
  s3: [FETCH],
  s5: [FETCH],
};
/** 没有可做的操作时，告诉管理员接下来由谁处理。 */
const NEXT: Record<string, string> = {
  d1: '口径由部署方确定，这里只读。确定后会自动继续检查，不需要你操作。',
  d6: '口径由部署方确定，这里只读。确定后会自动继续检查，不需要你操作。',
  d7: '引擎正在处理，不需要你操作。',
  d8: '引擎正在处理，不需要你操作。',
  s4: '资料由成员在客户端上传和整理，上传后自动进入治理。',
};
const isDoc = (x: Item) => /\.(md|pdf|csv|docx?|xlsx?)$/i.test(x.name);
const KINDS = ['全部', '业务数据', '资料'];
/** 三类来源各自对应接入栏里的哪一条。 */
const ORIGINS: { name: string; note: string; tone: Tone; id: string }[] = [
  { name: '外部数据集', note: '3 个业务系统 · 库存系统连续 3 次超时', tone: 'bad', id: 's3' },
  { name: '内部资料库', note: '23 份资料 · 最近上传 今天 09:38', tone: 'ok', id: 's4' },
  { name: '外网数据集', note: '3 个资讯来源 · 最近成功 今天 10:00', tone: 'ok', id: 's5' },
];
const toneClass = (t: Tone) => `tone-${t}`;

export function DataWork({
  picked,
  pick,
  filter,
  setFilter,
  gate,
  setGate,
}: {
  picked: string;
  pick: (id: string) => void;
  filter: number;
  setFilter: (i: number) => void;
  gate: number | null;
  setGate: (gate: number | null) => void;
}) {
  const all = tabs.data;
  // 当前栏目跟着选中的条目走：从待办、搜索或 3D 里点进来时，自动落在它所在的那一栏。
  const owner = all.findIndex((t) => t.items.some((x) => x.id === picked)),
    at = owner >= 0 ? owner : filter,
    tab = all[at] || all[0];
  const [kind, setKind] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const acts = (x: Item): Act[] => ACTS[x.id] || (x.tone === 'ok' && at !== 1 ? [HOLD] : []);
  const shown = tab.items.filter(
    (x) =>
      (at === 1 || kind === 0 || (kind === 2) === isDoc(x)) &&
      (at !== 0 || gate === null || (GATE_OF[x.id] === gate && x.tone !== 'run')),
  );
  const current = all.flatMap((t) => t.items).find((x) => x.id === picked) || shown[0] || tab.items[0];
  const groups = shown.reduce<[string, Item[]][]>((acc, x) => {
    const g = acc.find(([name]) => name === x.group);
    if (g) g[1].push(x);
    else acc.push([x.group, [x]]);
    return acc;
  }, []);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);
  const run = (x: Item, a: Act) => setDone((old) => ({ ...old, [x.id]: a.done }));
  const undo = (x: Item) => setDone(({ [x.id]: _, ...rest }) => rest);
  // ↑↓ 换条目，回车执行这一条的主操作，不离开键盘。
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget.querySelector('[aria-pressed="true"]')) {
      const a = acts(current)[0];
      if (a && !done[current.id]) (e.preventDefault(), run(current, a));
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = shown.findIndex((x) => x.id === current.id);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    pick(next.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
  };
  const open = (i: number, id?: string) => {
    setFilter(i);
    const first = id || all[i].items[0]?.id;
    if (first) pick(first);
  };
  const flow = steps[current.id],
    history = runs[current.id],
    mine = acts(current),
    result = done[current.id];
  return (
    <section className="cards work data" aria-label="数据基座">
      <article className="card list">
        <div className="tabs" role="tablist" aria-label="数据基座栏目">
          {all.map((f, i) => (
            <button key={f.label} type="button" role="tab" aria-selected={at === i} onClick={() => open(i)}>
              {f.label}
            </button>
          ))}
        </div>
        {(at !== 1 || gate !== null) && (
          <div className="filters">
            {at !== 1 &&
              KINDS.map((k, i) => (
                <button key={k} type="button" aria-pressed={kind === i} onClick={() => setKind(i)}>
                  {k}
                </button>
              ))}
            {at === 0 && gate !== null && (
              <button type="button" className="on" onClick={() => setGate(null)}>
                卡在“{GATES[gate]}” ×
              </button>
            )}
          </div>
        )}
        <div className="card-scroll" ref={list} onKeyDown={keys}>
          {groups.length === 0 && <p className="none">没有符合条件的记录。</p>}
          {groups.map(([name, items]) => (
            <div key={name}>
              <h3>
                {name} <span>{items.length}</span>
              </h3>
              {items.map((x) => {
                const a = acts(x)[0];
                return (
                  <div
                    key={x.id}
                    className="row"
                    role="button"
                    tabIndex={0}
                    aria-pressed={x.id === current.id}
                    onClick={() => pick(x.id)}
                  >
                    <i className={toneClass(done[x.id] ? 'ok' : x.tone)} />
                    <span className="t">
                      <b>{x.name}</b>
                      <span className={x.tone === 'bad' && !done[x.id] ? 'tone-bad-text' : undefined}>
                        {done[x.id] || x.why}
                      </span>
                    </span>
                    {done[x.id] ? (
                      <button
                        type="button"
                        className="act undo"
                        onClick={(e) => (e.stopPropagation(), undo(x))}
                      >
                        撤销
                      </button>
                    ) : a ? (
                      <button type="button" className="act" onClick={(e) => (e.stopPropagation(), run(x, a))}>
                        {a.label}
                      </button>
                    ) : (
                      <span className="s">{x.side}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </article>

      <article className="card detail" aria-live="polite">
        <header>
          <h2>{current.name}</h2>
          <span>
            {at === 1 ? '数据接入' : isDoc(current) ? '资料 · 内部资料库' : '业务数据 · 外部数据集'}
            {current.side && ` · ${current.side}`}
          </span>
        </header>
        <div className="card-scroll">
          <div className={`verdict act-bar ${toneClass(result ? 'ok' : current.tone)}`}>
            <p>{result ? `${result}。` : current.verdict}</p>
            <div>
              {result ? (
                <button type="button" onClick={() => undo(current)}>
                  撤销
                </button>
              ) : (
                mine.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className={a.quiet ? undefined : 'primary'}
                    onClick={() => run(current, a)}
                  >
                    {a.label}
                  </button>
                ))
              )}
            </div>
          </div>
          {!result && mine.length === 0 && NEXT[current.id] && <p className="next">{NEXT[current.id]}</p>}
          {flow && (
            <ol className="flow">
              {flow.map(([text, state], i) => (
                <li key={i} data-state={state}>
                  <b>{STEP_NAMES[i]}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          )}
          {history && (
            <div className="runs">
              <h3>最近 7 次取数</h3>
              <ol>
                {history.map(([when, ok], i) => (
                  <li key={i} className={ok ? 'ok' : 'bad'}>
                    <i />
                    <span>{when}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {current.kv.length > 0 && (
            <table>
              <thead>
                <tr>
                  {current.kvHead.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.kv.map(([a, b, c, tone]) => (
                  <tr key={a}>
                    <th>{a}</th>
                    <td>{b}</td>
                    <td className={`${toneClass(tone)}-text`}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>

      <div className="side">
        <article className="card facts">
          <header>
            <h2>治理进度</h2>
          </header>
          {stats.data.rows.map(([label, value, note], i) =>
            note ? (
              <button
                key={label}
                type="button"
                className="fact"
                aria-pressed={gate === i}
                onClick={() => {
                  const to = gate === i ? null : i;
                  setGate(to);
                  const first = all[0].items.find(
                    (x) => to === null || (GATE_OF[x.id] === to && x.tone !== 'run'),
                  );
                  open(0, first?.id);
                }}
              >
                <span>{label}</span>
                <b>{value}</b>
                <small>{note}</small>
              </button>
            ) : (
              <div key={label} className="fact">
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ),
          )}
        </article>
        <article className="card facts more">
          <header>
            <h2>三类来源</h2>
          </header>
          {ORIGINS.map((o) => (
            <button
              key={o.name}
              type="button"
              className="fact origin"
              aria-pressed={current.id === o.id}
              onClick={() => open(1, o.id)}
            >
              <span>
                <i className={toneClass(o.tone)} />
                {o.name}
              </span>
              <small className={o.tone === 'bad' ? 'tone-bad-text' : undefined}>{o.note}</small>
            </button>
          ))}
        </article>
      </div>
    </section>
  );
}
