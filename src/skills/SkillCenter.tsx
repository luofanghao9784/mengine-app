import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FolderOpen, Link2, Search, ShieldCheck, Sparkles, Star, X } from 'lucide-react';
import { useRemote } from '../shared/admin';
import { presentationClient } from '../conversation/presentation-client';
import { conversationHref } from '../conversation/Conversations';
import { skills, Preview, iconMap } from './catalog';
import type { Skill, SkillId } from './catalog';
import './skill-center.css';
export const skillsHref = (tenant: string) => '#' + new URLSearchParams({ tenant, view: 'skills' });
function stored(key: string): SkillId[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((id): id is SkillId => skills.some((s) => s.id === id)) : [];
  } catch {
    return [];
  }
}
export function SkillCenter({ tenant, account }: { tenant: string; account: string }) {
  const [tab, setTab] = useState('discover'),
    [query, setQuery] = useState(''),
    [detail, setDetail] = useState<Skill | null>(null);
  const key = `dreamcore:skill-favorites:${account}:${tenant}`;
  const [favorites, setFavorites] = useState(() => stored(key)),
    [storageError, setStorageError] = useState(false);
  const capability = useRemote((signal) => presentationClient.capability(tenant, signal), [tenant]);
  const ready = capability.value?.available === true;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
    else dialog.current?.close();
  }, [detail]);
  const favorite = (id: SkillId) => {
    const next = favorites.includes(id) ? favorites.filter((v) => v !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const status = (s: Skill) => (s.id !== 'ppt' ? '接入中' : ready ? '可使用' : '暂未开放');
  const filtered = skills.filter(
    (s) => (tab !== 'mine' || favorites.includes(s.id)) && `${s.title}${s.description}`.includes(query),
  );
  const start = () => {
    if (ready) {
      dialog.current?.close();
      location.hash = conversationHref(tenant) + '&skill=ppt';
    }
  };
  return (
    <section className="skill-center" aria-label="技能中心">
      <div className="page-heading">
        <div>
          <div className="overline">YOUR WORK, WITH SUPERPOWERS</div>
          <h2 className="center-title">让工作，更进一步</h2>
          <p>从一个想法，到一份可以直接使用的成果。</p>
        </div>
        {tab !== 'connections' && (
          <div className="search-wrap">
            <Search size={18} />
            <input
              aria-label="搜索技能"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索你想完成的工作"
            />
            {query && (
              <button aria-label="清空搜索" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="tab-line">
        <div className="tabs" role="tablist" aria-label="技能中心栏目">
          {[
            ['discover', '发现技能'],
            ['mine', '我的技能'],
            ['connections', '账号与连接'],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              key={id}
              onClick={() => {
                setTab(id);
                setQuery('');
              }}
            >
              {label}
              {id === 'mine' && <span>{favorites.length}</span>}
            </button>
          ))}
        </div>
        <span className="catalog-note">
          <ShieldCheck size={14} /> 梦擎适配 · 来源可追溯
        </span>
      </div>
      {tab === 'connections' ? (
        <>
          <div className="section-heading">
            <div>
              <h2>让技能使用你允许的资料</h2>
              <p>资料范围在每次调用时单独选择。</p>
            </div>
          </div>
          <div className="connection-card">
            <div className="connection-icon">
              <FolderOpen />
            </div>
            <div>
              <h3>
                梦擎空间资料 <span className="tag green-tag">内置来源</span>
              </h3>
              <p>遵守当前账号的空间权限，不访问电脑本地文件。</p>
              <div className="connection-skills">读取资料、保存成果与共享发布分别确认。</div>
            </div>
          </div>
          <div className="empty-connections">
            <Link2 size={30} />
            <h3>暂无外部账号连接</h3>
            <p>
              首批技能使用空间资料，无需额外连接。
              <br />
              外部服务完成接入后，会在这里提供授权入口。
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="featured-heading">
            <div>
              <Sparkles size={17} />
              <h3>{tab === 'mine' ? '你的常用技能' : '把重复的工作，交给技能'}</h3>
            </div>
            <span>
              {tab === 'mine' ? '收藏保存在当前设备，按账号和企业区分' : '首批 5 项 · 按接入进度开放'}
            </span>
          </div>
          {storageError && <p role="status">当前设备无法保存收藏，离开页面后可能丢失。</p>}
          <div className="skill-grid">
            {filtered.map((s) => {
              const Icon = iconMap[s.id];
              return (
                <article
                  key={s.id}
                  className={`skill-card ${s.color} ${tab === 'discover' && !query && ['ppt', 'dashboard'].includes(s.id) ? 'featured' : ''}`}
                >
                  <button
                    className="art-button"
                    aria-label={`查看${s.title}详情`}
                    onClick={() => setDetail(s)}
                  >
                    <Preview id={s.id} />
                  </button>
                  <div className="skill-card-body">
                    <div className="card-title">
                      <div>
                        <span className={`skill-icon ${s.color}`}>
                          <Icon size={18} />
                        </span>
                        <h3>{s.title}</h3>
                      </div>
                      <button
                        className={`favorite ${favorites.includes(s.id) ? 'saved' : ''}`}
                        aria-pressed={favorites.includes(s.id)}
                        aria-label={`${favorites.includes(s.id) ? '取消收藏' : '收藏'}${s.title}`}
                        onClick={() => favorite(s.id)}
                      >
                        <Star size={18} />
                      </button>
                    </div>
                    <p>{s.description}</p>
                    <div className="card-bottom">
                      <span className="output-format">{s.output}</span>
                      <button className="text-button" onClick={() => setDetail(s)}>
                        查看详情 <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="availability">
                      <span className="status-dot" />
                      {status(s)}
                      <span>·</span>
                      <span>
                        {s.id === 'ppt' && ready ? '先确认大纲，再生成演示文稿' : '开放后可在会话中调用'}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!filtered.length && (
            <div className="empty-connections">
              <Search size={30} />
              <h3>{query ? '没有找到相关技能' : '还没有收藏技能'}</h3>
              <p>在发现技能中点击星标，加入常用列表。</p>
              <button
                className="secondary"
                onClick={() => {
                  setTab('discover');
                  setQuery('');
                }}
              >
                查看全部技能
              </button>
            </div>
          )}
          <div className="conversation-tip">
            <ShieldCheck size={22} />
            <div>
              <h3>在会话中继续完成工作</h3>
              <p>选定技能后填写要求与资料，不会立即发送任务。成果默认私人，分享时另行确认。</p>
            </div>
          </div>
        </>
      )}
      <footer className="page-footer">卡片图片为合成成果示例。具体功能以当前开放状态为准。</footer>
      <dialog
        ref={dialog}
        className="detail-drawer"
        aria-label={detail ? `${detail.title}详情` : '技能详情'}
        onCancel={() => setDetail(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDetail(null);
        }}
      >
        {detail && (
          <>
            <div className="drawer-top">
              <span>技能详情</span>
              <button className="icon-button" aria-label="关闭详情" onClick={() => setDetail(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="drawer-scroll">
              <Preview id={detail.id} large />
              <div className="detail-heading">
                <div>
                  <span className="overline">{detail.eyebrow}</span>
                  <h2>{detail.title}</h2>
                </div>
                <span className="tag">{status(detail)}</span>
              </div>
              <p className="detail-description">{detail.description}</p>
              <div className="detail-facts">
                <div>
                  <small>准备什么</small>
                  <p>{detail.input}</p>
                </div>
                <div>
                  <small>你会得到</small>
                  <p>{detail.output}</p>
                </div>
              </div>
              <h3>{detail.id === 'ppt' ? '使用步骤' : '计划支持的流程'}</h3>
              <ol className="steps">
                {(detail.id === 'ppt'
                  ? ['选择资料与汇报目标', '核对大纲，调整标题与页序', '确认生成并下载演示文稿']
                  : detail.steps
                ).map((s, i) => (
                  <li key={s}>
                    <span>{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              <h3>资料与连接</h3>
              <div className="detail-connection">
                <FolderOpen size={18} />
                <div>
                  <b>梦擎空间资料</b>
                  <small>仅使用本次获准的资料范围</small>
                </div>
                <span>无需外部连接</span>
              </div>
              <details className="source-info">
                <summary>能力边界与开源来源</summary>
                <p>
                  {detail.id === 'ppt'
                    ? '当前支持 1–8 页固定版式，生成 PPTX 与内容源文件。请核对数据口径；模板导入、正文修改和在线预览尚未开放。'
                    : detail.boundary}
                </p>
                <a href={detail.url} target="_blank" rel="noreferrer">
                  {detail.source} ↗
                </a>
              </details>
            </div>
            <div className="drawer-footer">
              <span>
                {detail.id === 'ppt'
                  ? ready
                    ? '不会立即发送任务'
                    : '当前生成环境暂未开放'
                  : '完成接入后开放使用'}
              </span>
              <button className="primary" disabled={detail.id !== 'ppt' || !ready} onClick={start}>
                {detail.id === 'ppt' && ready ? '开始使用' : '暂未开放'}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
