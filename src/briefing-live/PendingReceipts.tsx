import { pendingReceipts } from './pending-receipts';
import './pending-receipts.css';
export { pendingReceipts } from './pending-receipts';

export function PendingReceipts({ data }: { data: NonNullable<ReturnType<typeof pendingReceipts>> }) {
  return (
    <div className="pending-receipts">
      <div className="pending-receipts-lead"><strong>{data.total}<small>笔</small></strong><span>历史记录显示待核对<br /><small>先确认是否已处理，再接续缺项</small></span></div>
      <div className="pending-receipts-groups">
        <div><span>待财务审核</span><strong>{data.review}<small>笔</small></strong><p>核对原凭证与确认结果</p></div>
        <div><span>待补凭证</span><strong>{data.receipt}<small>笔</small></strong><p>确认缺项后补齐材料</p></div>
      </div>
      <p className="pending-receipts-confirmed">同批另有 <b>{data.confirmed} 笔</b>财务已确认</p>
      <div className="pending-receipts-bottom"><small>历史收款记录 · 不代表当前待办</small></div>
    </div>
  );
}
