import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/UI/Sidebar';
import { Topbar } from './components/UI/Topbar';
import { MainContent } from './components/UI/MainContent';
import { setupRouter } from './router';
import { initCouchMode } from './couch';
import './toast';

const sidebarEl = document.getElementById('side');
if (sidebarEl) render(<Sidebar />, sidebarEl);

const topbarEl = document.getElementById('topbar-root');
if (topbarEl) render(<Topbar />, topbarEl);

const mainEl = document.getElementById('main-root');
if (mainEl) render(<MainContent />, mainEl);

const root = document.createElement('div');
root.id = 'preact-root';
document.body.appendChild(root);
render(<App />, root);

setupRouter();
initCouchMode();

// PWA: register the service worker in production builds only. In dev it would
// clash with Vite's HMR, so instead we tear down any worker left over from a
// previous production visit on the same origin.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
}
