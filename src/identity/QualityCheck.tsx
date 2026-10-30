import { Button } from '../shared/ui';
import './quality-check.css';

export const qualityCheckHref = (tenant: string) =>
  `#tenant=${encodeURIComponent(tenant)}&view=quality-check`;

/** 接线位：尚无企业已开通读模型，不读取、提交材料或生成结果。 */
export function QualityCheck() {
  return (
    <div className="quality-check">
      <section className="access-panel" aria-labelledby="quality-check-intro">
        <h2 id="quality-check-intro">① 进入说明</h2>
        <p>质量检查用于提交检查材料并查看处理结果。目前后台开通中，暂时不能使用。</p>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-submit">
        <h2 id="quality-check-submit">② 提交检查材料</h2>
        <Button disabled aria-describedby="quality-check-submit-reason">
          提交检查材料
        </Button>
        <p id="quality-check-submit-reason">暂时不能提交检查材料（后台开通中）</p>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-results">
        <h2 id="quality-check-results">③ 处理结果</h2>
        <p>暂时不能查看处理结果（后台开通中）</p>
      </section>
    </div>
  );
}
