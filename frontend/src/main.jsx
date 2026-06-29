import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Self-hosted fonts via fontsource (no CDN dependency)
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import ErrorBoundary from './components/ErrorBoundary.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
