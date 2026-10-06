/** Preview fixture only: the real platform dashboard against synthetic in-browser API responses. */
import { preview, scenarios } from './mock';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from '../../../src/identity/session';
import { PlatformEngineDashboard } from '../../../src/operations/PlatformEngineDashboard';
import '../../../src/styles.css';

function Preview() {
  const [scenario, setScenario] = useState(preview.scenario);
  return (
    <SessionProvider realm="platform">
      <div
        style={{
          position: 'fixed',
          right: 16,
          top: 64,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 4px 4px 12px',
          border: '1px dashed rgba(240,190,114,.5)',
          borderRadius: 999,
          background: 'rgba(11,10,9,.7)',
          color: '#F0BE72',
          font: '12px system-ui',
        }}
      >
        合成数据预览（非产品）
        {Object.entries(scenarios).map(([key, s]) => (
          <button
            key={key}
            type="button"
            aria-pressed={scenario === key}
            onClick={() => {
              preview.scenario = key;
              setScenario(key);
            }}
            style={{
              border: 0,
              borderRadius: 999,
              height: 26,
              padding: '0 10px',
              cursor: 'pointer',
              background: scenario === key ? 'rgba(236,234,228,.14)' : 'transparent',
              color: scenario === key ? '#ECEAE4' : '#ADA89E',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <PlatformEngineDashboard hash="#admin=engine" />
    </SessionProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
