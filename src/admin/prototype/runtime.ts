import { useEffect, useState } from 'react';
import { telemetryChannels, type EngineTelemetry } from '../../../contracts/public-api/engine-telemetry';
import type { UsageOverview } from '../../../contracts/public-api/usage';
import { getTelemetry } from '../../operations/telemetry-client';
import { usageClient } from '../../operations/usage-client';
import {
  addSample,
  changes,
  sample,
  type Sample,
  type Change,
} from '../../operations/engine-dashboard-model';

// A disconnected stage is motionless and its readouts are hidden by the host.
export const disconnectedTelemetry = (tenantId: string | null): EngineTelemetry => ({
  tenantId,
  checkedAt: new Date(0).toISOString(),
  recentSeconds: 300,
  evolution: 'NOT_CONNECTED',
  channels: telemetryChannels
    .filter((code) => code !== 'GENERAL_ADJUSTMENT')
    .map((code) => ({
      code,
      running: 0,
      queued: 0,
      waiting: 0,
      failed: 0,
      unknown: 0,
      completedRecent: 0,
      lastCompletedAt: null,
    })),
});
export function useSceneRuntime(tenant: string | null) {
  const [state, setState] = useState<{
    value?: EngineTelemetry;
    samples: Sample[];
    log: Change[];
    error: string;
  }>({ samples: [], log: [], error: '' });
  const [usage, setUsage] = useState<UsageOverview>();
  const [usageError, setUsageError] = useState('');
  useEffect(() => {
    if (!tenant) return;
    let disposed = false,
      previous: EngineTelemetry | undefined;
    const controllers = new Set<AbortController>();
    let telemetryTimer: ReturnType<typeof setTimeout>, usageTimer: ReturnType<typeof setTimeout>;
    const read = async (kind: 'telemetry' | 'usage') => {
      if (disposed) return;
      if (document.visibilityState !== 'hidden') {
        const c = new AbortController();
        controllers.add(c);
        try {
          if (kind === 'telemetry') {
            const value = await getTelemetry('tenant', tenant, c.signal);
            if (!disposed) {
              const delta = previous ? changes(previous, value).reverse() : [];
              previous = value;
              setState((old) => ({
                value,
                samples: addSample(old.samples, sample(value)),
                log: [...delta, ...old.log].slice(0, 8),
                error: '',
              }));
            }
          } else {
            const value = (await usageClient.read('tenant', tenant, 'THIS_MONTH', c.signal)) as UsageOverview;
            if (!disposed) {
              setUsage(value);
              setUsageError('');
            }
          }
        } catch {
          if (!disposed) {
            if (kind === 'telemetry') {
              previous = undefined;
              setState({ samples: [], log: [], error: '运行状态暂不可用，请检查登录与访问权限。' });
            } else {
              setUsage(undefined);
              setUsageError('用量暂不可用，请检查登录与访问权限。');
            }
          }
        } finally {
          controllers.delete(c);
        }
      }
      if (!disposed) {
        if (kind === 'telemetry') telemetryTimer = setTimeout(() => void read(kind), 3000);
        else usageTimer = setTimeout(() => void read(kind), 60000);
      }
    };
    void read('telemetry');
    void read('usage');
    return () => {
      disposed = true;
      controllers.forEach((c) => c.abort());
      clearTimeout(telemetryTimer);
      clearTimeout(usageTimer);
    };
  }, [tenant]);
  return { ...state, usage, usageError };
}
export type SceneRuntime = ReturnType<typeof useSceneRuntime>;
