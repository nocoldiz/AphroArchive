import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/Sidebar';
import { Search } from './components/Search';
import { MainContent } from './components/MainContent';
import { PlayerView } from './components/PlayerView';
import { setupRouter } from './router';

// 1. Mount the Sidebar
const sidebarEl = document.getElementById('side');
if (sidebarEl) render(<Sidebar />, sidebarEl);

// 2. Mount the Search Bar
const searchEl = document.querySelector('.search-w');
if (searchEl) render(<Search />, searchEl);

// 3. Mount the Main Content (Switcher)
const mainEl = document.getElementById('video-grid');
if (mainEl) render(<MainContent />, mainEl);

// 4. Mount the Player View
const playerEl = document.getElementById('player-view');
if (playerEl) render(<PlayerView />, playerEl);

// 5. Mount the Preact Root
const root = document.createElement('div');
root.id = 'preact-root';
document.body.appendChild(root);
render(<App />, root);

// Initialize Router
setupRouter();
