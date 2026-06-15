'use strict';

const includeSubdomainsEl = document.getElementById('includeSubdomains');
const defaultFilterEl = document.getElementById('defaultFilter');
const saveBtn = document.getElementById('save');
const savedEl = document.getElementById('saved');

(async () => {
  const settings = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
  includeSubdomainsEl.checked = !!settings.includeSubdomains;
  defaultFilterEl.value = settings.defaultFilter || '';
})();

saveBtn.addEventListener('click', async () => {
  await browser.runtime.sendMessage({
    type: 'SET_SETTINGS',
    settings: {
      includeSubdomains: includeSubdomainsEl.checked,
      defaultFilter: defaultFilterEl.value.trim()
    }
  });
  savedEl.style.display = 'inline';
  setTimeout(() => { savedEl.style.display = 'none'; }, 1500);
});
