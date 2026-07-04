import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/UI/Sidebar';
import { Topbar } from './components/UI/Topbar';
import { MainContent } from './components/UI/MainContent';
import { setupRouter } from './router';
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
