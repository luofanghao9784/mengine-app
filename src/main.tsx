import './shared/gesture-boundaries.css';
import { createRoot } from 'react-dom/client';
import { DemoBootstrap } from './ninepop/Bootstrap';
import './styles.css';
import './briefingDesign.css';
import './briefingFeedback.css';
import './library.css';
import './briefingMagazine.css';
createRoot(document.getElementById('root')!).render(<DemoBootstrap />);
