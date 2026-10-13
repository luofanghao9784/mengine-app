import { createRoot } from 'react-dom/client';
import '@fontsource/cormorant-garamond/latin-300.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import { SceneShell } from './SceneShell';

// 仅用于后台标签页里截图检查：?frames=timer 时用定时器代替 requestAnimationFrame，让舞台在不可见时也出帧。
if (new URLSearchParams(location.search).get('frames') === 'timer') {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
}

createRoot(document.getElementById('root')!).render(<SceneShell />);
