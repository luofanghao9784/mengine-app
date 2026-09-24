import { createRoot } from 'react-dom/client';
import App from './App';
import { DemoProvider } from './store';
import './styles.css';
import './briefingDesign.css';
import './briefingFeedback.css';
import './library.css';
import './briefingMagazine.css';
createRoot(document.getElementById('root')!).render(
  <DemoProvider>
    <App />
  </DemoProvider>,
);
