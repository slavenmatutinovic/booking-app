import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary'; // Uvozimo naš ErrorBoundary komponentu

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Obmotavamo celu aplikaciju */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
