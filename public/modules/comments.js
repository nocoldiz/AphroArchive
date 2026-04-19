// ── Shared Comments Widget ────────────────────────────────────────────────────
// CommentsWidget.init(videoId, videoName, listEl, countEl?, opts?)
//   opts: { theme: 'dark'|'light' }
// Endpoints used:
//   GET  /api/comments/:id?name=...   → comment[]
//   POST /api/comments/:id/add        → { text, parentId?, videoName } → { comment, reply? }
// ─────────────────────────────────────────────────────────────────────────────
window.CommentsWidget = (() => {
  'use strict';

  // ── Internal utils ─────────────────────────────────────────────────────────
  const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function _hash(s) { let h=0; for(let i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0; return Math.abs(h); }
  function _color(name) { return 'hsl('+(_hash(name)%360)+',55%,45%)'; }
  function _ago(ts) {
    const s = Math.floor((Date.now()-(ts||0))/1000);
    if (s<60)    return s+'s';
    if (s<3600)  return Math.floor(s/60)+'m';
    if (s<86400) return Math.floor(s/3600)+'h';
    return Math.floor(s/86400)+'d';
  }

  // ── Per-comment vote state (localStorage) ─────────────────────────────────
  const _votes = {};
  function _getVote(id) {
    if (_votes[id] != null) return _votes[id];
    try { _votes[id] = parseInt(localStorage.getItem('cw_v_'+id)||'0'); } catch { _votes[id]=0; }
    return _votes[id];
  }
  function _setVote(id, v) {
    _votes[id] = v;
    try { localStorage.setItem('cw_v_'+id, String(v)); } catch {}
  }

  // Per-comment base score (deterministic)
  function _baseScore(c) { return c.isAI ? (10+_hash(c.id)%990) : (1+_hash(c.id)%49); }
  function _score(c)     { return _baseScore(c)+(_getVote(c.id)||0); }

  // ── Widget state ───────────────────────────────────────────────────────────
  let _vid='', _vname='', _listEl=null, _countEl=null, _sort='best', _theme='dark';
  let _all=[];          // flat comment array
  const _collapsed=new Set(); // comment ids that are collapsed

  // ── Sort flat list ─────────────────────────────────────────────────────────
  function _sortList(arr) {
    const a = [...arr];
    if (_sort==='top')  return a.sort((x,y)=>_score(y)-_score(x));
    if (_sort==='new')  return a.sort((x,y)=>(y.ts||0)-(x.ts||0));
    if (_sort==='old')  return a.sort((x,y)=>(x.ts||0)-(y.ts||0));
    return a.sort((x,y)=>_score(y)-_score(x)); // best
  }

  // ── Build tree ────────────────────────────────────────────────────────────
  function _tree(flat) {
    const map={}, roots=[];
    flat.forEach(c => { map[c.id]={...c,kids:[]}; });
    flat.forEach(c => {
      if (c.parentId && map[c.parentId]) map[c.parentId].kids.push(map[c.id]);
      else if (!c.parentId) roots.push(map[c.id]);
    });
    return roots;
  }

  // ── Render single node recursively ────────────────────────────────────────
  function _node(c, depth) {
    const vote    = _getVote(c.id);
    const sc      = _score(c);
    const collapsed = _collapsed.has(c.id);
    const hasKids = c.kids && c.kids.length>0;
    const sortedKids = hasKids ? _sortList(c.kids) : [];
    const isYou   = c.author==='You';
    const col     = isYou ? 'var(--ac,#ff4500)' : _color(c.author);
    const ind     = Math.min(depth,6)*16;

    const upCol   = vote>0  ? '#ff4500' : 'var(--cw-tx2,#818384)';
    const dnCol   = vote<0  ? '#7193ff' : 'var(--cw-tx2,#818384)';
    const scCol   = vote>0  ? '#ff4500' : vote<0 ? '#7193ff' : 'var(--cw-tx2,#818384)';

    let html = `<div class="cw-c" data-id="${_esc(c.id)}" style="margin-left:${ind}px;padding:8px 0 2px;border-top:1px solid var(--cw-brd,rgba(128,128,128,.15))">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#fff;flex-shrink:0">${_esc(isYou?'Y':c.author[0].toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:12px;font-weight:700">${_esc(c.author)}</span>
            <span style="font-size:11px;color:var(--cw-tx2,#818384)">${_ago(c.ts)}</span>
            <span style="font-size:11px;font-weight:700;color:${scCol}">▲ ${sc}</span>
            ${hasKids ? `<button class="cw-tog" data-cid="${_esc(c.id)}" style="font-size:11px;color:var(--cw-tx2,#818384);background:none;border:none;cursor:pointer;padding:0 2px;line-height:1">${collapsed?`[+] ${c.kids.length} repl${c.kids.length===1?'y':'ies'}`:'[–]'}</button>` : ''}
          </div>`;

    if (collapsed) {
      html += `<div style="font-size:12px;color:var(--cw-tx2,#818384);padding-bottom:4px">${c.kids.length} repl${c.kids.length===1?'y':'ies'} hidden</div>`;
    } else {
      html += `<div style="font-size:13px;line-height:1.55;margin-bottom:6px">${_esc(c.text)}</div>
        <div style="display:flex;gap:2px;align-items:center;margin-bottom:6px">
          <button class="cw-vote" data-cid="${_esc(c.id)}" data-dir="1" style="font-size:13px;background:none;border:none;cursor:pointer;color:${upCol};padding:2px 4px;line-height:1">▲</button>
          <button class="cw-vote" data-cid="${_esc(c.id)}" data-dir="-1" style="font-size:13px;background:none;border:none;cursor:pointer;color:${dnCol};padding:2px 4px;line-height:1">▼</button>
          <button class="cw-repl" data-cid="${_esc(c.id)}" style="font-size:11px;font-weight:700;background:none;border:none;cursor:pointer;color:var(--cw-tx2,#818384);padding:2px 8px;line-height:1">Reply</button>
        </div>
        <div class="cw-rf" data-for="${_esc(c.id)}" style="display:none;margin-bottom:8px">
          <div style="display:flex;gap:6px">
            <input type="text" placeholder="Write a reply…" style="flex:1;background:var(--cw-inp,rgba(128,128,128,.12));border:1px solid var(--cw-brd,rgba(128,128,128,.2));color:inherit;padding:5px 8px;border-radius:4px;font-size:12px;outline:none" onkeydown="if(event.key==='Enter')CommentsWidget._reply(this)">
            <button onclick="CommentsWidget._reply(this.previousElementSibling)" style="background:var(--ac,#ff4500);color:#fff;border:none;padding:5px 10px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">Reply</button>
            <button onclick="this.closest('.cw-rf').style.display='none'" style="background:none;border:1px solid var(--cw-brd,rgba(128,128,128,.2));color:var(--cw-tx2,#818384);padding:5px 8px;border-radius:4px;font-size:12px;cursor:pointer">✕</button>
          </div>
        </div>`;
      sortedKids.forEach(k => { html += _node(k, depth+1); });
    }

    html += `</div></div></div>`;
    return html;
  }

  // ── Sort bar + comment count header ────────────────────────────────────────
  function _sortBar(total) {
    const btn = (s, label) =>
      `<button class="cw-sb${_sort===s?' cw-sb-on':''}" onclick="CommentsWidget.sort('${s}')" style="font-size:11px;font-weight:700;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:3px;color:${_sort===s?'var(--ac,#ff4500)':'var(--cw-tx2,#818384)'}">${label}</button>`;
    return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--cw-brd,rgba(128,128,128,.15))">
      <span style="font-size:12px;font-weight:700;color:var(--cw-tx2,#818384);margin-right:4px">Sort:</span>
      ${btn('best','Best')}${btn('top','Top')}${btn('new','New')}${btn('old','Old')}
      <span style="margin-left:auto;font-size:12px;color:var(--cw-tx2,#818384)">${total} comment${total!==1?'s':''}</span>
    </div>`;
  }

  // ── Full render ────────────────────────────────────────────────────────────
  function _render() {
    if (!_listEl) return;
    const roots = _sortList(_tree(_all));
    const total = _all.length;
    if (_countEl) _countEl.textContent = total + ' Comment' + (total!==1?'s':'');

    let html = _sortBar(total);
    if (!roots.length) {
      html += '<div style="color:var(--cw-tx2,#818384);font-size:13px;padding:12px 0">No comments yet.</div>';
    } else {
      roots.forEach(c => { html += _node(c, 0); });
    }

    // Main input
    html += `<div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--cw-brd,rgba(128,128,128,.15))">
      <input type="text" id="cw-main-inp" placeholder="Add a comment…" style="flex:1;background:var(--cw-inp,rgba(128,128,128,.12));border:1px solid var(--cw-brd,rgba(128,128,128,.2));color:inherit;padding:7px 10px;border-radius:4px;font-size:13px;outline:none" onkeydown="if(event.key==='Enter')CommentsWidget._main(this)">
      <button onclick="CommentsWidget._main(document.getElementById('cw-main-inp'))" style="background:var(--ac,#ff4500);color:#fff;border:none;padding:7px 14px;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">Comment</button>
    </div>`;

    _listEl.innerHTML = html;
    _attachEvents();
  }

  function _attachEvents() {
    if (!_listEl) return;
    _listEl.querySelectorAll('.cw-vote').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const cid=b.dataset.cid, dir=parseInt(b.dataset.dir), cur=_getVote(cid);
        _setVote(cid, cur===dir ? 0 : dir);
        _render();
      };
    });
    _listEl.querySelectorAll('.cw-tog').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const cid=b.dataset.cid;
        if(_collapsed.has(cid)) _collapsed.delete(cid); else _collapsed.add(cid);
        _render();
      };
    });
    _listEl.querySelectorAll('.cw-repl').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const cid=b.dataset.cid;
        const rf=_listEl.querySelector('.cw-rf[data-for="'+cid+'"]');
        if(!rf) return;
        const open = rf.style.display==='none';
        // Close all others
        _listEl.querySelectorAll('.cw-rf').forEach(f=>f.style.display='none');
        if(open) { rf.style.display=''; rf.querySelector('input').focus(); }
      };
    });
  }

  // ── Submit helpers ─────────────────────────────────────────────────────────
  async function _post(text, parentId) {
    const r = await fetch('/api/comments/'+encodeURIComponent(_vid)+'/add', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ videoName:_vname, text, parentId: parentId||null })
    });
    if (!r.ok) return;
    const d = await r.json();
    if (d.comment) _all.push(d.comment);
    if (d.reply)   _all.push(d.reply);
    _render();
  }

  function _main(inp) {
    const text=inp.value.trim(); if(!text) return;
    inp.value=''; inp.disabled=true;
    _post(text, null).finally(()=>{ inp.disabled=false; });
  }

  function _reply(inp) {
    const text=inp.value.trim(); if(!text) return;
    const rf=inp.closest('.cw-rf');
    const parentId=rf ? rf.dataset.for : null;
    inp.value=''; inp.disabled=true;
    if(rf) rf.style.display='none';
    _post(text, parentId).finally(()=>{ inp.disabled=false; });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  async function init(videoId, videoName, listEl, countEl, opts) {
    _vid    = videoId;
    _vname  = videoName;
    _listEl = typeof listEl==='string' ? document.getElementById(listEl) : listEl;
    _countEl= typeof countEl==='string' ? document.getElementById(countEl) : (countEl||null);
    _sort   = (opts&&opts.sort) || 'best';
    _theme  = (opts&&opts.theme) || 'dark';
    _all    = [];
    _collapsed.clear();
    if (!_listEl) return 0;

    _listEl.innerHTML='<div style="color:var(--cw-tx2,#818384);font-size:13px;padding:8px 0">Loading…</div>';
    try {
      const r = await fetch('/api/comments/'+encodeURIComponent(videoId)+'?name='+encodeURIComponent(videoName));
      if (r.ok) _all = await r.json();
    } catch {}

    _render();
    return _all.filter(c=>!c.parentId).length;
  }

  function sort(s) { _sort=s; _render(); }

  return { init, sort, _main, _reply };
})();
