// ─── Zapping Mode ───
function toggleZapping() {
  if (zapOn) {
    stopZapping();
  } else {
    if (mosaicOn) stopMosaic();
    zapOn = true;
    zapLock = false;
    $('zapUI').el.style.display = 'flex';
    $('zapLockBtn').text('Lock to Current');
    $('bv').add('off');
    $('pv').add('on');
    startZapping();
  }
}

function stopZapping() {
  zapOn = false;
  clearTimeout(zapTimer);
  $('zapUI').show(false);
  $('vP').show();
  $('vP_zap').show(false);
  activePlayer = 'vP';
  goHome();
}

function setZapIv(delta) {
  zapIv = Math.max(2, zapIv + delta);
  $('zapIv').text(zapIv + 's');
}

function toggleZapLock() {
  zapLock = !zapLock;
  $('zapLockBtn').text(zapLock ? 'Unlock (Resume Zapping)' : 'Lock to Current');
  if (!zapLock) {
    zapTimer = setTimeout(doZapSwitch, zapIv * 1000);
  } else {
    clearTimeout(zapTimer);
  }
}

function getRandomVidForZapping() {
  let list = cat ? V.filter(v => v.category === cat || v.catPath === cat) : V;
  list = list.filter(v => !bookmarkVidIds.has(v.id));
  if (!list.length) list = V.filter(v => !bookmarkVidIds.has(v.id));
  if (!list.length) list = V;
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

async function startZapping() {
  await prepareNextZap();
  doZapSwitch();
}

async function prepareNextZap() {
  if (zapLock) return;
  zapNextVid = getRandomVidForZapping();
  if (!zapNextVid) return;
  const d = await (await fetch('/api/videos/' + zapNextVid.id)).json();
  const duration = d.video.duration || 60;
  zapNextTime = Math.random() * Math.max(0, duration - zapIv);
  const nextPlayerId = activePlayer === 'vP' ? 'vP_zap' : 'vP';
  const vpNext = $(nextPlayerId).el;
  vpNext.src = '/api/stream/' + zapNextVid.id + '#t=' + zapNextTime;
  vpNext.load();
  vpNext.pause();
}

async function doZapSwitch() {
  if (!zapOn || zapLock) return;
  if (!zapNextVid) await prepareNextZap();
  if (!zapNextVid) return;

  const nextPlayerId = activePlayer === 'vP' ? 'vP_zap' : 'vP';
  const currPlayerId = activePlayer;
  const vpNext = $(nextPlayerId).el;
  const vpCurr = $(currPlayerId).el;

  vpNext.style.display = '';
  vpNext.currentTime = zapNextTime;
  vpNext.play().catch(e => console.log('Autoplay prevented:', e));
  vpCurr.pause();
  vpCurr.style.display = 'none';
  activePlayer = nextPlayerId;

  curV = zapNextVid;
  $('pT').text(curV.name);
  if ($('pC').el) $('pC').text(curV.category);

  prepareNextZap();
  zapTimer = setTimeout(doZapSwitch, zapIv * 1000);
}
