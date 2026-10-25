import { lazy, memo, Suspense } from 'react';

// 场景外壳和它的样式、3D 代码单独成块：只在进入企业管理端时加载，不混进工作空间与总台。
const SceneShell = lazy(() => import('./prototype/SceneShell').then((m) => ({ default: m.SceneShell })));

/** 企业管理端：直接在本页渲染场景外壳，与本页共用登录状态、地址与快捷键。 */
export const TenantScene = memo(function TenantScene({ tenant }: { tenant: string }) {
  return (
    <main style={{ position: 'fixed', inset: 0, background: '#171a1b' }}>
      <Suspense fallback={null}>
        <SceneShell key={tenant} tenant={tenant} />
      </Suspense>
    </main>
  );
});
