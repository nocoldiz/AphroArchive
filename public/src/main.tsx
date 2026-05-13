import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/UI/Sidebar';
import { Topbar } from './components/UI/Topbar';
import { MainContent } from './components/UI/MainContent';
import { setupRouter } from './router';

// 1. Mount the Sidebar
const sidebarEl = document.getElementById('side');
if (sidebarEl) render(<Sidebar />, sidebarEl);

// 2. Mount the Topbar
const topbarEl = document.getElementById('topbar-root');
if (topbarEl) render(<Topbar />, topbarEl);

// 3. Mount the Main Content (Switcher)
const mainEl = document.getElementById('main-root');
if (mainEl) render(<MainContent />, mainEl);



// 5. Mount the Preact Root
const root = document.createElement('div');
root.id = 'preact-root';
document.body.appendChild(root);
render(<App />, root);

// Initialize Router
setupRouter();
