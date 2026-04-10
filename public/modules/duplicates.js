// ─── Duplicates ───
function showDups() {
  if (location.pathname !== '/duplicates') history.pushState(null, '', '/duplicates');
  dupMode = true;
  document.getElementById('bv').classList.add('off');
  document.getElementById('pv').classList.remove('on');
  document.getElementById('dv').classList.add('on');
  document.getElementById('dupSB').classList.add('on');
  document.getElementById('vaultV').classList.remove('on');
  document.getElementById('vaultSB').classList.remove('on');
  document.getElementById('scraperV').classList.remove('on');
  document.getElementById('scraperSB').classList.remove('on');
  document.getElementById('settingsV').classList.remove('on');
  document.getElementById('settingsSB').classList.remove('on');
  if (document.getElementById('dbV')) document.getElementById('dbV').classList.remove('on');
  vaultMode = false; scraperMode = false; importFavsMode = false; settingsMode = false; dbMode = false;
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.remove('on');
  document.getElementById('actorSB').classList.remove('on');
  document.getElementById('sv').classList.remove('on');
  document.getElementById('sdv').classList.remove('on');
  document.getElementById('studioSB').classList.remove('on');
  document.getElementById('tagDV').classList.remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  curTag = null;
  if (curV) {
    const vp = document.getElementById('vP');
    vp.pause(); vp.src = '';
    curV = null;
  }
  loadDups();
}

async function loadDups() {
  document.getElementById('dupContent').innerHTML = '<div class="dup-scan">Scanning for duplicates\u2026</div>';
  const groups = await (await fetch('/api/duplicates')).json();
  renderDups(groups);
}

function renderDups(groups) {
  const el = document.getElementById('dupContent');
  const nBtn = document.getElementById('dupN');
  if (!groups.length) {
    nBtn.style.display = 'none';
    el.innerHTML = '<div class="es" style="padding:40px 20px"><h3>No duplicates found</h3><p>All videos appear to be unique</p></div>';
    return;
  }
  nBtn.textContent = groups.length;
  nBtn.style.display = '';
  const totalVids = groups.reduce((s, g) => s + g.length, 0);
  const wasted = groups.reduce((s, g) => s + g[0].size * (g.length - 1), 0);
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  let h = '<div class="dup-meta">' + totalVids + ' videos across ' + groups.length + ' groups &mdash; <b>' + fmtBytes(wasted) + '</b> potentially wasted</div>';
  groups.forEach(group => {
    h += '<div class="dup-group">';
    h += '<div class="dup-gh"><span class="dup-cnt">' + group.length + ' copies</span> &nbsp;&bull;&nbsp; ' + group[0].sizeF + ' each</div>';
    h += '<div class="dup-cards">';
    group.forEach(v => {
      const c = cols[Math.abs(hsh(v.category)) % cols.length];
      const bg = 'linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)';
      h += '<div class="dup-card">';
      h += '<div class="dup-th" data-vid="' + v.id + '" style="background:' + bg + '" onclick="openVid(\'' + v.id + '\')">';
      h += '<div class="po"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div></div>';
      h += '<div class="dup-info">';
      h += '<div class="dup-name" title="' + escA(v.name) + '">' + esc(v.name) + '</div>';
      h += '<div class="dup-cat">' + esc(v.rel) + '</div>';
      h += '<button class="dup-del" onclick="delVideo(\'' + v.id + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div></div>';
  });
  el.innerHTML = h;
  attachThumbs();
}
