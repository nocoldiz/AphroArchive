'use strict';

const listEl = document.getElementById('links');
const countEl = document.getElementById('count');
const modeRadios = document.querySelectorAll('input[name="mode"]');
const scrapeBtn = document.getElementById('scrapeBtn');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const filterInput = document.getElementById('filter');
const optionsLink = document.getElementById('optionsLink');

function buildFilterRegex() {
  const pattern = filterInput.value.trim();
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

async function getFilteredUrls() {
  const links = await browser.runtime.sendMessage({ type: 'GET_LINKS' });
  const re = buildFilterRegex();
  return Object.values(links)
    .filter((l) => !re || re.test(l.url))
    .sort((a, b) => b.ts - a.ts);
}

async function refresh() {
  const filtered = await getFilteredUrls();
  countEl.textContent = filtered.length;

  listEl.innerHTML = '';
  for (const l of filtered) {
    const li = document.createElement('li');

    const span = document.createElement('span');
    span.className = 'url';
    span.textContent = l.url;
    span.title = l.text ? `${l.text}\n${l.url}` : l.url;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ type: 'REMOVE_LINK', url: l.url });
      refresh();
    });

    li.appendChild(span);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  }
}

scrapeBtn.addEventListener('click', async () => {
  scrapeBtn.disabled = true;
  scrapeBtn.textContent = 'Scraping...';
  try {
    await browser.runtime.sendMessage({ type: 'SCRAPE_TAB' });
  } catch (err) {
    scrapeBtn.textContent = err.message || 'Failed';
    setTimeout(() => { scrapeBtn.textContent = 'Scrape Current Page'; }, 1500);
    scrapeBtn.disabled = false;
    return;
  }
  scrapeBtn.disabled = false;
  scrapeBtn.textContent = 'Scrape Current Page';
  refresh();
});

copyBtn.addEventListener('click', async () => {
  const filtered = await getFilteredUrls();
  await navigator.clipboard.writeText(filtered.map((l) => l.url).join('\n'));
  const original = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => { copyBtn.textContent = original; }, 1200);
});

exportBtn.addEventListener('click', async () => {
  const filtered = await getFilteredUrls();
  const blob = new Blob([filtered.map((l) => l.url).join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({ url, filename: 'scraped-links.txt', saveAs: true });
});

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all scraped links?')) return;
  await browser.runtime.sendMessage({ type: 'CLEAR_LINKS' });
  refresh();
});

filterInput.addEventListener('input', refresh);

for (const radio of modeRadios) {
  radio.addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({ type: 'SET_MODE', mode: e.target.value });
  });
}

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

(async () => {
  const [mode, settings] = await Promise.all([
    browser.runtime.sendMessage({ type: 'GET_MODE' }),
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' })
  ]);
  for (const radio of modeRadios) radio.checked = radio.value === mode;
  if (settings.defaultFilter) filterInput.value = settings.defaultFilter;
  refresh();
})();

browser.storage.onChanged.addListener((changes) => {
  if (changes.scrapedLinks) refresh();
});
