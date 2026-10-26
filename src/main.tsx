import './shared/gesture-boundaries.css';
import { createRoot } from 'react-dom/client';
import { DemoBootstrap } from './ninepop/Bootstrap';
import './styles.css';
import './briefingDesign.css';
import './briefingFeedback.css';
import './library.css';
import './briefingMagazine.css';
if (window.location.pathname === '/native-conversations') {
  void import('./native-conversation/NativeConversations').then(({ NativeConversations }) => {
    createRoot(document.getElementById('root')!).render(<NativeConversations />);
  });
} else {
  createRoot(document.getElementById('root')!).render(<DemoBootstrap />);
}
