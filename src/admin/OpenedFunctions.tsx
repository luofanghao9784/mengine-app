import { ClipboardCheck } from 'lucide-react';
import { Empty } from '../shared/ui';
import { Loading } from '../shared/admin';
import { qualityCheckHref } from '../identity/QualityCheck';
import { openedCapabilitiesFailureTitle, useOpenedCapabilities } from './openedCapabilities';

export function OpenedFunctions({ tenant }: { tenant: string }) {
  const { items, error } = useOpenedCapabilities(tenant);
  return (
    <section className="admin-section" aria-labelledby="tenant-opened-heading">
      <div className="admin-section-heading">
        <div>
          <h2 id="tenant-opened-heading">已开通</h2>
          <p className="admin-note">总部开通给本企业的 AI 功能会出现在这里。</p>
        </div>
      </div>
      {error ? (
        <Empty
          icon={ClipboardCheck}
          title={openedCapabilitiesFailureTitle(error)}
          text="开通信息暂时无法读取，请稍后刷新重试。"
        />
      ) : !items ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty
          icon={ClipboardCheck}
          title="还没有已开通的 AI 功能"
          text="总部开通给本企业后，功能会显示在这里。"
        />
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.enterpriseFunction}>
              {item.enterpriseFunction === 'quality-check' ? (
                <a href={`/workspace/${qualityCheckHref(tenant)}`}>{item.displayName}</a>
              ) : (
                item.displayName
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
