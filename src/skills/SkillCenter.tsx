import { useState } from 'react';
import { ArrowRight, FolderOpen, Search } from 'lucide-react';
import { useRemote } from '../shared/admin';
import { Button, Empty, Modal, PageActions } from '../shared/ui';
import { LibrarySearch } from '../material/LibraryToolbar';
import { presentationClient } from '../conversation/presentation-client';
import { conversationHref } from '../conversation/Conversations';
import { skills, Preview, iconMap } from './catalog';
import type { Skill } from './catalog';
import './skill-center.css';
export const skillsHref = (tenant: string) => '#' + new URLSearchParams({ tenant, view: 'skills' });
const pptSteps = ['选择资料与汇报目标', '核对大纲，调整标题与页序', '确认生成并下载演示文稿'];
const pptBoundary =
  '当前支持 1–8 页固定版式，生成 PPTX 与内容源文件。请核对数据口径；模板导入、正文修改和在线预览尚未开放。';
export function SkillCenter({ tenant }: { tenant: string }) {
  const [scope, setScope] = useState<'all' | 'ready'>('all'),
    [query, setQuery] = useState(''),
    [detail, setDetail] = useState<Skill | null>(null);
  const capability = useRemote((signal) => presentationClient.capability(tenant, signal), [tenant]);
  const ready = capability.value?.available === true;
  const usable = (s: Skill) => s.id === 'ppt' && ready;
  const status = (s: Skill) => (s.id !== 'ppt' ? '即将开放' : ready ? '可使用' : '暂未开放');
  const word = query.trim();
  const shown = skills.filter(
    (s) =>
      (scope === 'all' || usable(s)) && `${s.title}${s.eyebrow}${s.description}${s.output}`.includes(word),
  );
  const main = shown.filter((s) => s.id === 'ppt'),
    upcoming = shown.filter((s) => s.id !== 'ppt');
  const start = () => {
    setDetail(null);
    location.hash = conversationHref(tenant) + '&skill=ppt';
  };
  const steps = (s: Skill) => (s.id === 'ppt' ? pptSteps : s.steps);
  return (
    <section className="skill-center skill-ui" aria-label="技能中心">
      <PageActions>
        <div className="material-tabs" aria-label="技能范围">
          <Button variant={scope === 'all' ? 'primary' : 'ghost'} onClick={() => setScope('all')}>
            全部技能
          </Button>
          <Button variant={scope === 'ready' ? 'primary' : 'ghost'} onClick={() => setScope('ready')}>
            可使用
          </Button>
        </div>
      </PageActions>
      <PageActions placement="meta">
        <LibrarySearch
          label="搜索技能"
          query={query}
          onQuery={setQuery}
          onSearch={() => {}}
          onClear={() => setQuery('')}
        />
      </PageActions>
      {main.map((s) => {
        const Icon = iconMap[s.id];
        return (
          <article className="skill-hero" key={s.id}>
            <button className="skill-hero-art" aria-label={`查看${s.title}详情`} onClick={() => setDetail(s)}>
              <Preview id={s.id} large />
            </button>
            <div className="skill-hero-body">
              <div className="skill-hero-title">
                <span className={`skill-icon ${s.color}`}>
                  <Icon size={20} />
                </span>
                <div>
                  <small>{s.eyebrow}</small>
                  <h2>{s.title}</h2>
                </div>
                <span className={`skill-status ${usable(s) ? 'ready' : ''}`}>{status(s)}</span>
              </div>
              <p className="skill-hero-text">{s.description}</p>
              <dl className="skill-facts">
                <div>
                  <dt>准备什么</dt>
                  <dd>{s.input}</dd>
                </div>
                <div>
                  <dt>你会得到</dt>
                  <dd>{s.output}</dd>
                </div>
                <div>
                  <dt>怎么进行</dt>
                  <dd>先确认大纲，再生成文稿</dd>
                </div>
              </dl>
              <div className="skill-hero-actions">
                <Button variant="primary" disabled={!usable(s)} onClick={start}>
                  {usable(s) ? '开始使用' : '暂未开放'}
                  <ArrowRight size={16} />
                </Button>
                <Button variant="ghost" onClick={() => setDetail(s)}>
                  了解详情
                </Button>
                <span>{usable(s) ? '进入会话后填写要求，不会立即发送任务' : '当前生成环境暂未开放'}</span>
              </div>
            </div>
          </article>
        );
      })}
      {upcoming.length > 0 && (
        <>
          <h3 className="skill-section">
            即将开放 <span>{upcoming.length}</span>
          </h3>
          <div className="skill-row">
            {upcoming.map((s) => {
              const Icon = iconMap[s.id];
              return (
                <button
                  className="skill-tile"
                  key={s.id}
                  aria-label={`查看${s.title}详情`}
                  onClick={() => setDetail(s)}
                >
                  <Preview id={s.id} />
                  <span className="skill-tile-body">
                    <span className="skill-tile-title">
                      <span className={`skill-icon ${s.color}`}>
                        <Icon size={16} />
                      </span>
                      <b>{s.title}</b>
                    </span>
                    <span className="skill-tile-text">{s.description}</span>
                    <span className="skill-tile-foot">{s.output}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {!shown.length && (
        <Empty
          icon={Search}
          title={word ? '没有找到相关技能' : '暂时没有可使用的技能'}
          text={word ? '换一个说法试试，或查看全部技能。' : '技能开放后会出现在这里。'}
        >
          <Button
            onClick={() => {
              setScope('all');
              setQuery('');
            }}
          >
            查看全部技能
          </Button>
        </Empty>
      )}
      {detail && (
        <Modal title="技能详情" onClose={() => setDetail(null)} className="skill-detail-modal">
          <div className="skill-ui skill-detail">
            <Preview id={detail.id} large />
            <div className="skill-detail-heading">
              <div>
                <small>{detail.eyebrow}</small>
                <h2>{detail.title}</h2>
              </div>
              <span className={`skill-status ${usable(detail) ? 'ready' : ''}`}>{status(detail)}</span>
            </div>
            <p className="skill-detail-text">{detail.description}</p>
            <dl className="skill-facts">
              <div>
                <dt>准备什么</dt>
                <dd>{detail.input}</dd>
              </div>
              <div>
                <dt>你会得到</dt>
                <dd>{detail.output}</dd>
              </div>
            </dl>
            <h3>{detail.id === 'ppt' ? '使用步骤' : '计划支持的流程'}</h3>
            <ol className="skill-steps">
              {steps(detail).map((step, i) => (
                <li key={step}>
                  <span>{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="skill-scope">
              <FolderOpen size={16} />
              使用梦擎空间里的资料，遵守你的空间权限；每次使用时单独选择资料范围，成果默认只有你能看到。
            </p>
            <details className="skill-source">
              <summary>能力边界与开源来源</summary>
              <p>{detail.id === 'ppt' ? pptBoundary : detail.boundary}</p>
              <a href={detail.url} target="_blank" rel="noreferrer">
                {detail.source} ↗
              </a>
            </details>
          </div>
          <div className="modal-actions skill-detail-actions">
            <span>
              {detail.id !== 'ppt'
                ? '开放后可在会话中使用'
                : ready
                  ? '不会立即发送任务'
                  : '当前生成环境暂未开放'}
            </span>
            <Button variant="primary" disabled={!usable(detail)} onClick={start}>
              {usable(detail) ? '开始使用' : status(detail)}
              <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
