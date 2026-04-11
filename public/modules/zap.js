// ─── Zapping Mode ───
function toggleZapping() {
  if (zapOn) {
    stopZapping();
  } else {
    if (mosaicOn) stopMosaic();
    zapOn = true;
    zapLock = false;
    $('zap-ui').el.style.display = 'flex';
    $('zap-lock-btn').text('Lock to Current');
    $('browse-view').add('off');
    $('player-view').add('on');
    startZapping();
  }
}

function stopZapping() {
  zapOn = false;
  clearTimeout(zapTimer);
  $('zap-ui').show(false);
  $('video-player').show();
  $('video-player-zap').show(false);
  activePlayer = 'video-player';
  goHome();
}

function setZapIv(delta) {
  zapIv = Math.max(2, zapIv + delta);
  $('zap-interval').text(zapIv + 's');
}

function toggleZapLock() {
  zapLock = !zapLock;
  $('zap-lock-btn').text(zapLock ? 'Unlock (Resume Zapping)' : 'Lock to Current');
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
  const nextPlayerId = activePlayer === 'video-player' ? 'video-player-zap' : 'video-player';
  const vpNext = $(nextPlayerId).el;
  vpNext.src = '/api/stream/' + zapNextVid.id + '#t=' + zapNextTime;
  vpNext.load();
  vpNext.pause();
}

async function doZapSwitch() {
  if (!zapOn || zapLock) return;
  if (!zapNextVid) await prepareNextZap();
  if (!zapNextVid) return;

  const nextPlayerId = activePlayer === 'video-player' ? 'video-player-zap' : 'video-player';
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
  $('player-title').text(curV.name);
  if ($('player-category').el) $('player-category').text(curV.category);

  prepareNextZap();
  zapTimer = setTimeout(doZapSwitch, zapIv * 1000);
}
