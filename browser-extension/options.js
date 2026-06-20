'use strict';

const serverUrlEl = document.getElementById('serverUrl');
const minPhotoSizeEl = document.getElementById('minPhotoSize');
const includeSubdomainsEl = document.getElementById('includeSubdomains');
const defaultFilterEl = document.getElementById('defaultFilter');
const saveBtn = document.getElementById('save');
const savedEl = document.getElementById('saved');

(async () => {
  const settings = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
  serverUrlEl.value = settings.serverUrl || 'http://localhost:3000';
  minPhotoSizeEl.value = settings.minPhotoSize ?? 150;
  includeSubdomainsEl.checked = !!settings.includeSubdomains;
  defaultFilterEl.value = settings.defaultFilter || '';
})();

saveBtn.addEventListener('click', async () => {
  const min = parseInt(minPhotoSizeEl.value, 10);
  await browser.runtime.sendMessage({
    type: 'SET_SETTINGS',
    settings: {
      serverUrl: serverUrlEl.value.trim() || 'http://localhost:3000',
      minPhotoSize: Number.isFinite(min) && min >= 0 ? min : 150,
      includeSubdomains: includeSubdomainsEl.checked,
      defaultFilter: defaultFilterEl.value.trim()
    }
  });
  savedEl.style.display = 'inline';
  setTimeout(() => { savedEl.style.display = 'none'; }, 1500);
});
