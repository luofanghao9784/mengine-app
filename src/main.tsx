import { createRoot } from 'react-dom/client';
import App from './App';
import { DemoProvider } from './store';
import './styles.css';
import './briefingDesign.css';
import './library.css';
createRoot(document.getElementById('root')!).render(
  <DemoProvider>
    <App />
  </DemoProvider>,
);
