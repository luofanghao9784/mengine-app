import { ClipboardCheck } from 'lucide-react';
import { Loading } from '../shared/admin';
import { openedCapabilitiesFailureTitle, type OpenedCapabilitiesState } from '../admin/openedCapabilities';
import { Empty } from '../shared/ui';
import { Button } from '../shared/ui';
import './quality-check.css';

export const qualityCheckHref = (tenant: string) =>
  `#tenant=${encodeURIComponent(tenant)}&view=quality-check`;

/** Enablement is read-only; submission and execution are outside this slice. */
export function QualityCheck({ opened }: { opened: OpenedCapabilitiesState }) {
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
        title="本企业尚未开通此 AI 功能"
        text="请联系企业管理员确认，开通后再进入。"
      />
    );
  return (
    <div className="quality-check">
      <section className="access-panel" aria-labelledby="quality-check-intro">
        <h2 id="quality-check-intro">① 进入说明</h2>
        <p>质量检查用于提交检查材料并查看处理结果。材料提交与结果读取尚未接通。</p>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-submit">
        <h2 id="quality-check-submit">② 提交检查材料</h2>
        <Button disabled aria-describedby="quality-check-submit-reason">
          提交检查材料
        </Button>
        <p id="quality-check-submit-reason">暂时不能提交检查材料（执行服务尚未接通）</p>
      </section>
      <section className="access-panel" aria-labelledby="quality-check-results">
        <h2 id="quality-check-results">③ 处理结果</h2>
        <p>暂时不能查看处理结果（执行服务尚未接通）</p>
      </section>
    </div>
  );
}
