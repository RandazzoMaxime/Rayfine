import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DisplayWindow from './components/views/DisplayWindow';
import { installFrontendLogBridge } from './utils/frontendLogBridge';
import './styles.css';

installFrontendLogBridge();

async function boot() {
  let isDisplayWindow =
    (window as Window & { __RAYFINE_WINDOW_ROLE?: string }).__RAYFINE_WINDOW_ROLE === 'display' ||
    new URLSearchParams(window.location.search).get('role') === 'display';
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (getCurrentWindow().label === 'display') isDisplayWindow = true;
  } catch {
    /* not in Tauri */
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      {isDisplayWindow ? <DisplayWindow /> : <App />}
    </React.StrictMode>,
  );
}

boot();
