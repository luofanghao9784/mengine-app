import { ClipboardCheck } from 'lucide-react';
import { Empty } from '../shared/ui';

/** 接线位：企业已开通读模型落地后再接入，当前不读取或推断开通状态。 */
export function OpenedFunctions() {
  return (
    <section className="admin-section" aria-labelledby="tenant-opened-heading">
      <div className="admin-section-heading">
        <div>
          <h2 id="tenant-opened-heading">已开通</h2>
          <p className="admin-note">总部开通给本企业的 AI 功能会出现在这里。</p>
        </div>
      </div>
      <Empty
        icon={ClipboardCheck}
        title="暂时不能查看已开通功能（后台开通中）"
        text="开通信息暂时无法查看，请等待后台开通。"
      />
    </section>
  );
}
