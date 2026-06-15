'use strict';

const LINKS_KEY = 'scrapedLinks';
const MODE_KEY = 'mode'; // 'manual' | 'auto'
const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
  includeSubdomains: true,
  defaultFilter: '' // regex applied when listing/copying/exporting
};

// Executed in the page context via scripting.executeScript.
// Must be self-contained (no closures over background.js variables).
function scrapePageLinks(includeSubdomains) {
  function registrableDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }

  const origin = location.origin;
  const baseDomain = registrableDomain(location.hostname);
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const seen = new Set();
  const links = [];

  for (const a of anchors) {
    let href;
    try {
      href = new URL(a.getAttribute('href'), location.href).href;
    } catch {
      continue;
    }

    let u;
    try {
      u = new URL(href);
    } catch {
      continue;
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

    const isInternal = includeSubdomains
      ? registrableDomain(u.hostname) === baseDomain
      : u.origin === origin;

    if (!isInternal) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    links.push({ url: href, text: (a.textContent || '').trim().slice(0, 140) });
  }

  return { page: location.href, title: document.title, links };
}

async function getLinks() {
  const { [LINKS_KEY]: links = {} } = await browser.storage.local.get(LINKS_KEY);
  return links;
}

async function addLinks(newLinks, pageInfo) {
  const links = await getLinks();
  let added = 0;
  for (const l of newLinks) {
    if (!links[l.url]) {
      links[l.url] = { url: l.url, text: l.text, sourcePage: pageInfo.page, ts: Date.now() };
      added++;
    }
  }
  await browser.storage.local.set({ [LINKS_KEY]: links });
  return added;
}

async function getSettings() {
  const { [SETTINGS_KEY]: settings = {} } = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function scrapeTab(tabId) {
  const settings = await getSettings();
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: scrapePageLinks,
    args: [settings.includeSubdomains]
  });
  if (result) await addLinks(result.links, result);
  return result;
}

browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.type) {
    case 'SCRAPE_TAB': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.startsWith('http')) {
        throw new Error('This page cannot be scraped.');
      }
      return scrapeTab(tab.id);
    }
    case 'GET_LINKS':
      return getLinks();
    case 'CLEAR_LINKS':
      await browser.storage.local.set({ [LINKS_KEY]: {} });
      return true;
    case 'REMOVE_LINK': {
      const links = await getLinks();
      delete links[msg.url];
      await browser.storage.local.set({ [LINKS_KEY]: links });
      return true;
    }
    case 'GET_MODE': {
      const { [MODE_KEY]: mode = 'manual' } = await browser.storage.local.get(MODE_KEY);
      return mode;
    }
    case 'SET_MODE':
      await browser.storage.local.set({ [MODE_KEY]: msg.mode });
      return true;
    case 'GET_SETTINGS':
      return getSettings();
    case 'SET_SETTINGS':
      await browser.storage.local.set({ [SETTINGS_KEY]: { ...(await getSettings()), ...msg.settings } });
      return true;
    default:
      return undefined;
  }
});

// Auto mode: re-scrape whenever a tracked tab finishes navigating.
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('http')) return;

  const { [MODE_KEY]: mode = 'manual' } = await browser.storage.local.get(MODE_KEY);
  if (mode !== 'auto') return;

  try {
    await scrapeTab(tabId);
  } catch {
    // Page may not allow script injection (e.g. about:, addons.mozilla.org) - ignore.
  }
});
