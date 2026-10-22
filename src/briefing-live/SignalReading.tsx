import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { presentationOf } from './presentation';
import { readingGroups } from './reading-groups';
import './news-reading.css';

export function isSignalReading(document: BriefingDocument) {
  const presentation = presentationOf(document);
  // Keep the card's named options/actions intact when opening its full text.
  if (presentation?.layout === 'COMPARISON' || presentation?.layout === 'STEPS') return false;
  return readingGroups(document.content.analysis, presentation?.sections).structured;
}
export function SignalReading({ document }: { document: BriefingDocument }) {
  const groups = readingGroups(document.content.analysis, presentationOf(document)?.sections);
  return <div className="news-reading signal-reading">
    {groups.facts.length > 0 && <section className="news-reading-source" aria-label="内容解读">
      <h3>{document.content.businessType === 'INFO' ? '资讯解读' : '经营信号'}</h3>
      {groups.facts.map((text, i) => <p key={i}>{text}</p>)}
    </section>}
    {(groups.judgments.length > 0 || groups.actions.length > 0) && <section className="news-reading-advice" aria-label="AI 建议">
      <header><span className="news-reading-ai">AI</span><h3>对我们的启发与建议</h3></header>
      {groups.judgments.map((text, i) => <p key={i}>{text}</p>)}
      {groups.actions.length > 0 && <><h4>可以先做什么</h4>{groups.actions.map((text, i) => <p key={i}>{text}</p>)}</>}
      {groups.cautions.length > 0 && <div className="news-reading-caution"><h4>决策前需确认</h4>{groups.cautions.map((text, i) => <p key={i}>{text}</p>)}</div>}
    </section>}
    {!groups.judgments.length && !groups.actions.length && groups.cautions.length > 0 && <section className="news-reading-caution"><h3>决策前需确认</h3>{groups.cautions.map((text, i) => <p key={i}>{text}</p>)}</section>}
  </div>;
}
