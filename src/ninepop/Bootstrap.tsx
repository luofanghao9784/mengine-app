import { useEffect, useState } from 'react';
import App from '../App';
import { DemoProvider } from '../store';
import { createNinepopSeed, NINEPOP_STORAGE_KEY } from './adapter';
import type { DemoState } from '../model';
import type { NinepopPackage } from './types';

export function DemoBootstrap() {
  const ninepop = new URLSearchParams(window.location.search).get('scenario') === 'ninepop';
  const [seed, setSeed] = useState<DemoState>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ninepop) return;
    const controller = new AbortController();
    fetch('/__private-demo/ninepop', {
      headers: { 'X-Dreamcore-Local-Demo': '1' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('9POP资料包未启用。请使用本机的 npm run demo:9pop 启动。');
        return r.json() as Promise<NinepopPackage>;
      })
      .then((bundle) => setSeed(createNinepopSeed(bundle)))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [ninepop]);
  if (!ninepop)
    return (
      <DemoProvider>
        <App />
      </DemoProvider>
    );
  if (!seed)
    return (
      <main className="page-container" role="status">
        <h1>9POP内部试用</h1>
        <p>{error || '正在加载本机已核验的资料包…'}</p>
        {error && <a href="/">返回默认演示</a>}
      </main>
    );
  return (
    <DemoProvider initialState={seed} privateStorageKey={NINEPOP_STORAGE_KEY}>
      <App />
    </DemoProvider>
  );
}
