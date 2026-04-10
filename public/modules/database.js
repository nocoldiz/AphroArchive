// ─── Database ───
function showDatabase() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/database') history.pushState(null, '', '/database');
  dbMode = true;
  document.getElementById('bv').classList.add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','foldersV','importFavsV'].forEach(id => document.getElementById(id).classList.remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  document.getElementById('databaseSB').classList.add('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false;
  collectionsMode = false; settingsMode = false; studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null;
  document.getElementById('dbV').classList.add('on');
  loadDbTab(dbTab);
}

async function loadDbTab(tab) {
  dbTab = tab;
  document.querySelectorAll('.db-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('dbGrid').innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  const r = await fetch('/api/db/' + tab);
  _dbData = await r.json();
  renderDbCards(_dbData, tab);
}

function dbSwitchTab(tab) { loadDbTab(tab); }

function renderDbCards(data, tab) {
  const entries = Object.entries(data);
  if (!entries.length) {
    document.getElementById('dbGrid').innerHTML = '<div class="es" style="padding:40px 20px;text-align:center"><h3 style="color:var(--tx2)">No entries yet</h3><p style="color:var(--tx3)">Click + Add to create one</p></div>';
    return;
  }
  document.getElementById('dbGrid').innerHTML = entries.map(([name, info]) => dbCard(name, info, tab)).join('');
}

function dbCard(name, info, tab) {
  let details = '';
  if (tab === 'actors') {
    if (info.imdb_page)     details += '<a href="' + escA(info.imdb_page) + '" target="_blank" class="db-link" onclick="event.stopPropagation()">IMDb ↗</a>';
    if (info.date_of_birth) details += '<div class="db-field"><span class="db-lbl">Born</span><span>' + esc(info.date_of_birth) + '</span></div>';
    if (info.nationality)   details += '<div class="db-field"><span class="db-lbl">From</span><span>' + esc(info.nationality) + '</span></div>';
    if (info.movies)        details += '<div class="db-field db-movies"><span>' + esc(info.movies.slice(0, 120)) + (info.movies.length > 120 ? '\u2026' : '') + '</span></div>';
  } else if (tab === 'categories') {
    const tags = Array.isArray(info.tags) ? info.tags : [];
    if (tags.length) details += '<div class="db-tags">' + tags.map(t => '<span class="db-tag">' + esc(t) + '</span>').join('') + '</div>';
  } else if (tab === 'studios') {
    if (info.website)           details += '<a href="' + escA(info.website) + '" target="_blank" class="db-link" onclick="event.stopPropagation()">Website ↗</a>';
    if (info.short_description) details += '<div class="db-field db-movies"><span>' + esc(info.short_description.slice(0, 160)) + (info.short_description.length > 160 ? '\u2026' : '') + '</span></div>';
  }
  const encName = escA(name);
  return '<div class="db-card">' +
    '<div class="db-card-hd">' +
    '<span class="db-name">' + esc(name) + '</span>' +
    '<div class="db-card-acts">' +
    '<button onclick="dbShowEdit(\'' + encName + '\')" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
    '<button onclick="dbDeleteEntry(\'' + encName + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' +
    '</div></div>' +
    '<div class="db-card-body">' + details + '</div>' +
    '</div>';
}

function dbShowAdd() { openDbModal(null); }
function dbShowEdit(name) { openDbModal(name, _dbData[name]); }

function openDbModal(name, data) {
  const isEdit = !!name;
  document.getElementById('dbMoTitle').textContent = isEdit ? 'Edit \u2014 ' + name : 'Add Entry';
  const body = document.getElementById('dbMoBody');
  let fields = '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Name</label><input class="stg-ta" id="dbMoName" style="padding:8px;min-height:0" value="' + (isEdit ? escA(name) : '') + '" ' + (isEdit ? 'readonly' : '') + ' placeholder="Entry name"></div>';
  if (dbTab === 'actors') {
    fields += dbFieldInput('IMDb URL', 'dbMoImdb', data?.imdb_page || '');
    fields += dbFieldInput('Date of Birth', 'dbMoDob', data?.date_of_birth || '');
    fields += dbFieldInput('Nationality', 'dbMoNat', data?.nationality || '');
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Movies</label><textarea class="stg-ta" id="dbMoMovies" style="min-height:70px">' + esc(data?.movies || '') + '</textarea></div>';
  } else if (dbTab === 'categories') {
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Tags / Aliases (comma-separated)</label><input class="stg-ta" id="dbMoTags" style="padding:8px;min-height:0" value="' + escA((data?.tags || []).join(', ')) + '" placeholder="alias1, alias2"></div>';
  } else if (dbTab === 'studios') {
    fields += dbFieldInput('Website URL', 'dbMoWebsite', data?.website || '');
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Description</label><textarea class="stg-ta" id="dbMoDesc" style="min-height:70px">' + esc(data?.short_description || '') + '</textarea></div>';
  }
  body.innerHTML = fields;
  document.getElementById('dbMo').style.display = 'flex';
}

function dbFieldInput(label, id, value) {
  return '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">' + label + '</label><input class="stg-ta" id="' + id + '" style="padding:8px;min-height:0" value="' + escA(value) + '"></div>';
}

function closeDbModal() { document.getElementById('dbMo').style.display = 'none'; }

async function dbSaveModal() {
  const name = document.getElementById('dbMoName').value.trim();
  if (!name) { toast('Name is required'); return; }
  let data = {};
  if (dbTab === 'actors') {
    data = {
      imdb_page:     document.getElementById('dbMoImdb')?.value.trim() || '',
      date_of_birth: document.getElementById('dbMoDob')?.value.trim() || '',
      nationality:   document.getElementById('dbMoNat')?.value.trim() || '',
      movies:        document.getElementById('dbMoMovies')?.value.trim() || '',
    };
  } else if (dbTab === 'categories') {
    const tagsRaw = document.getElementById('dbMoTags')?.value || '';
    data = { displayName: name, tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean) };
  } else if (dbTab === 'studios') {
    data = {
      website:           document.getElementById('dbMoWebsite')?.value.trim() || '',
      short_description: document.getElementById('dbMoDesc')?.value.trim() || '',
    };
  }
  const r = await fetch('/api/db/' + dbTab, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data })
  });
  if (!r.ok) { toast('Save failed'); return; }
  closeDbModal();
  toast('Saved');
  loadDbTab(dbTab);
}

async function dbDeleteEntry(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  const r = await fetch('/api/db/' + dbTab + '/' + encodeURIComponent(name), { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Deleted');
  loadDbTab(dbTab);
}

async function dbImportVideos() {
  const ta = document.getElementById('dbImportPaths');
  const paths = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!paths.length) { toast('Enter at least one file path'); return; }
  const status = document.getElementById('dbImportStatus');
  status.textContent = 'Copying\u2026';
  const r = await fetch('/api/db/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths })
  });
  const d = await r.json();
  const ok = d.results.filter(x => x.ok).length;
  const fail = d.results.filter(x => !x.ok).length;
  status.textContent = ok + ' copied' + (fail ? ', ' + fail + ' failed' : '');
  if (ok) { ta.value = d.results.filter(x => !x.ok).map(x => x.path).join('\n'); toast(ok + ' video' + (ok !== 1 ? 's' : '') + ' copied'); refresh(); }
  else toast('No files copied \u2014 check paths');
}
