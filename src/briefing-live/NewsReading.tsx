import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { presentationOf } from './presentation';
import './news-reading.css';

// User-approved wording correction for the existing news card; keep other
// cautions unchanged, including their business-specific limits.
const legacyCaution =
  '与本企业现有收退款资料分开使用：原文支持选题线索，不能证明门店增长。引用原文见来源链接，后续以客户反馈和获准经营数据复核。';
const decisionCaution =
  '这份行业报告只能作为服务探索的线索，不能证明本店客户有同样需求，也不能据此判断门店增长。是否试点，还需结合客户反馈和实际经营数据。';

export function NewsReading({ document }: { document: BriefingDocument }) {
  const sections = presentationOf(document)?.sections ?? [];
  const reading: string[] = [],
    suggestions: string[] = [],
    cautions: string[] = [];
  document.content.analysis.forEach((text, index) => {
    const role = sections.find((section) => section.paragraphIndex === index)?.role;
    // Stored editorial roles take priority. Legacy prose is separated only when
    // it explicitly labels advice or its scope; ordinary reporting stays intact.
    if (
      role === 'ACTION' ||
      role === 'OPTION' ||
      (!role && /^(?:对[^：:。]{1,20}的建议|AI建议|建议)[：:]/.test(text))
    ) {
      suggestions.push(text);
    } else if (role === 'CAUTION' || (!role && /^与本企业现有.+分开使用[：:]/.test(text))) {
      cautions.push(text === legacyCaution ? decisionCaution : text);
    } else {
      reading.push(text);
    }
  });
  return (
    <div className="news-reading">
      <section className="news-reading-digest" aria-label="要点速览">
        <h3>要点速览</h3>
        <p>{document.content.summary}</p>
      </section>
      {reading.length > 0 && (
        <section className="news-reading-source" aria-label="资讯解读">
          <h3>资讯解读</h3>
          {reading.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </section>
      )}
      {suggestions.length > 0 && (
        <section className="news-reading-advice" aria-label="AI 建议">
          <header>
            <span className="news-reading-ai">AI</span>
            <h3>对我们的启发与建议</h3>
          </header>
          {suggestions.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
          {cautions.length > 0 && (
            <div className="news-reading-caution">
              <h4>决策前需确认</h4>
              {cautions.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          )}
        </section>
      )}
      {!suggestions.length && cautions.length > 0 && (
        <section className="news-reading-caution" aria-label="决策前需确认">
          <h3>决策前需确认</h3>
          {cautions.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </section>
      )}
    </div>
  );
}
