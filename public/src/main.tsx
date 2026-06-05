import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/UI/Sidebar';
import { Topbar } from './components/UI/Topbar';
import { MainContent } from './components/UI/MainContent';
import { setupRouter } from './router';
import { AndroidSetup } from './components/AndroidSetup';

const ANDROID_SERVER_KEY = 'aphroarchive_server_url';
const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
const savedServer = isNative ? localStorage.getItem(ANDROID_SERVER_KEY) : null;

if (isNative && savedServer) {
  const orig = window.fetch.bind(window);
  (window as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return orig(savedServer + input, init);
    }
    return orig(input, init);
  };
}

if (isNative && !savedServer) {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <AndroidSetup onSave={(url) => {
      localStorage.setItem(ANDROID_SERVER_KEY, url);
      location.reload();
    }} />,
    root,
  );
} else {
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
}
