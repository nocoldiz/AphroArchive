import { render } from 'preact';
import { App } from './App';
import { Sidebar } from './components/Sidebar';
import { Search } from './components/Search';
import { VideoGrid } from './components/VideoGrid';

// 1. Mount the new Sidebar
const sidebarEl = document.getElementById('side');
if (sidebarEl) {
  render(<Sidebar />, sidebarEl);
}

// 2. Mount the new Search Bar
const searchEl = document.querySelector('.search-w');
if (searchEl) {
  render(<Search />, searchEl);
}

// 3. Mount the new Video Grid
const gridEl = document.getElementById('video-grid');
if (gridEl) {
  render(<VideoGrid />, gridEl);
}

// 4. Mount the Preact Root
const root = document.createElement('div');
root.id = 'preact-root';
document.body.appendChild(root);
render(<App />, root);
