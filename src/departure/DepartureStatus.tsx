import { useContext, useEffect, useState } from 'react';
import { Button } from '../shared/ui';
import { RequestPending } from '../shared/request-guard';
import { useRemote } from '../shared/admin';
import { departureClient } from './client';
import './departure.css';
/** Contains no reason, source identifiers or other people's details; safe in the platform shell. */
export function DepartureStatus({
  tenant,
  platform = false,
  verification = 0,
}: {
  tenant: string;
  platform?: boolean;
  verification?: number;
}) {
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const update = () => setRefresh((n) => n + 1);
    window.addEventListener('departure-state-changed', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('departure-state-changed', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  const remote = useRemote(
    (signal) => departureClient.businessStatus(tenant, platform, signal),
    [tenant, platform, verification, refresh],
  );
  if (remote.error)
    return (
      <p className="departure-status" role="status">
        业务状态暂不可确认
      </p>
    );
  if (!remote.value)
    return (
      <p className="departure-status" role="status">
        正在核对业务状态…
      </p>
    );
  const s = remote.value;
  // Normal operation is silent across every page; only exceptional states need a banner.
  if (s.businessEnabled) return null;
  return (
    <div className="departure-status stopped" role="status">
      <strong>
        {s.exitState === 'COMPLETE'
          ? '已退出 · 在线清理完成'
          : s.exitState
            ? '企业退出中 · 普通业务已停止'
            : '业务已停用'}
      </strong>
      {s.exitState && !platform && <ExitRecordLink tenant={tenant} revision={refresh} />}
      {s.exitState && (
        <span>
          迁出截止：{new Date(s.exportDeadline!).toLocaleString('zh-CN')}。
          {s.canExport ? '你可在当前指定共享范围内迁出。' : '当前没有可用的迁出权限。'}
          {s.exitState === 'COMPLETE' ? '备份副本仍需独立核验。' : ''}
        </span>
      )}
    </div>
  );
}

/** The history endpoint checks the actor's own explicit designation, including after its deadline. */
function ExitRecordLink({ tenant, revision }: { tenant: string; revision: number }) {
  const pending = useContext(RequestPending);
  const records = useRemote((signal) => departureClient.list(tenant, 0, signal), [tenant, revision]);
  if (!records.value?.items.length) return null;
  return (
    <Button
      disabled={pending}
      onClick={() => {
        location.href = `/workspace/#tenant=${tenant}&view=departure`;
      }}
    >
      查看迁出与清理记录
    </Button>
  );
}
