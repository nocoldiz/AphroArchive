#!/usr/bin/env python3
"""
AphroArchive Categorizer + Duplicate Finder
Self-contained Python/Tkinter GUI that talks to a running AphroArchive server.

Requirements: Python 3.8+
Optional:     pip install pillow   (enables thumbnail images)

Usage:
  python categorizer.py [http://localhost:3000]
"""

import sys
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import json
import threading
import urllib.request
import urllib.parse
import urllib.error
import io
import os
import re
import difflib
from typing import Optional, List, Dict, Set, Tuple, Any

try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ── Colours ───────────────────────────────────────────────────────────────────
BG   = '#1a1a1a'
BG2  = '#242424'
BG3  = '#2e2e2e'
TX   = '#e8e8e8'
TX2  = '#a0a0a0'
TX3  = '#666666'
AC   = '#e84040'
BRD  = '#383838'

CARD_W   = 155
THUMB_H  = 87   # 16:9
PAD      = 6

# ── Runtime config ────────────────────────────────────────────────────────────
SERVER = (sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:3000')

# ── API ───────────────────────────────────────────────────────────────────────

def _req(path: str, method: str = 'GET', data: Any = None):
    body = json.dumps(data).encode() if data is not None else None
    req  = urllib.request.Request(f'{SERVER}{path}', data=body, method=method)
    if body:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def api_get(p):          return _req(p)
def api_post(p, d=None): return _req(p, 'POST', d)
def api_patch(p, d):     return _req(p, 'PATCH', d)
def api_delete(p, d):    return _req(p, 'DELETE', d)

def fetch_thumb_bytes(vid_id: str) -> Optional[bytes]:
    try:
        safe = urllib.parse.quote(vid_id, safe='')
        url  = f'{SERVER}/api/thumbs/{safe}/0'
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.read()
    except Exception:
        return None

# ── Fuzzy match (mirrors the TSX implementation) ──────────────────────────────

def fuzzy_match(target: str, query: str) -> bool:
    target = target.lower()
    query  = query.lower()
    ti = 0
    for ch in query:
        if ch == ' ':
            continue
        ti = target.find(ch, ti)
        if ti == -1:
            return False
        ti += 1
    return True

# ── Thumb image cache (keeps PhotoImage alive to prevent GC) ──────────────────

_thumb_cache: Dict[str, Any] = {}   # vid_id -> ImageTk.PhotoImage | 'loading' | 'error'
_thumb_lock  = threading.Lock()

def get_or_load_thumb(vid_id: str, on_ready):
    with _thumb_lock:
        state = _thumb_cache.get(vid_id)
    if state is None:
        with _thumb_lock:
            _thumb_cache[vid_id] = 'loading'
        threading.Thread(target=_load_thumb_bg, args=(vid_id, on_ready), daemon=True).start()
    elif state not in ('loading', 'error') and HAS_PIL:
        on_ready(vid_id, state)

def _load_thumb_bg(vid_id: str, on_ready):
    data = fetch_thumb_bytes(vid_id)
    if data and HAS_PIL:
        try:
            img = Image.open(io.BytesIO(data))
            img = img.resize((CARD_W - 4, THUMB_H), Image.LANCZOS)
            photo = ImageTk.PhotoImage(img)
            with _thumb_lock:
                _thumb_cache[vid_id] = photo
            on_ready(vid_id, photo)
            return
        except Exception:
            pass
    with _thumb_lock:
        _thumb_cache[vid_id] = 'error'

# ── Scrollable video grid ─────────────────────────────────────────────────────

class VideoGrid(tk.Frame):
    """A scrollable grid of video cards. Calls on_select(id, shift_held) on click."""

    def __init__(self, master, on_select, **kw):
        super().__init__(master, bg=BG, **kw)
        self.on_select = on_select
        self._cards: Dict[str, tk.Frame] = {}
        self._selected: Set[str] = set()
        self._order: List[str] = []

        self._canvas = tk.Canvas(self, bg=BG, highlightthickness=0, bd=0)
        self._sb     = ttk.Scrollbar(self, orient='vertical', command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=self._sb.set)
        self._sb.pack(side='right', fill='y')
        self._canvas.pack(side='left', fill='both', expand=True)

        self._inner = tk.Frame(self._canvas, bg=BG)
        self._win   = self._canvas.create_window((0, 0), window=self._inner, anchor='nw')

        self._inner.bind('<Configure>', self._on_inner_configure)
        self._canvas.bind('<Configure>', self._on_canvas_configure)
        self._canvas.bind('<MouseWheel>', self._on_scroll)
        self._canvas.bind('<Button-4>',   lambda e: self._canvas.yview_scroll(-1, 'units'))
        self._canvas.bind('<Button-5>',   lambda e: self._canvas.yview_scroll( 1, 'units'))

    def _on_inner_configure(self, _):
        self._canvas.configure(scrollregion=self._canvas.bbox('all'))

    def _on_canvas_configure(self, e):
        self._canvas.itemconfig(self._win, width=e.width)
        self._reflow(e.width)

    def _on_scroll(self, e):
        self._canvas.yview_scroll(int(-1 * (e.delta / 120)), 'units')

    def _cols(self, width: int) -> int:
        return max(1, width // (CARD_W + PAD))

    def populate(self, videos: List[dict], selected: Set[str]):
        self._selected = set(selected)
        self._cards.clear()
        self._order.clear()
        for w in self._inner.winfo_children():
            w.destroy()

        for v in videos:
            self._order.append(v['id'])
            card = self._make_card(v)
            self._cards[v['id']] = card

        self._reflow(self._canvas.winfo_width())
        self._canvas.yview_moveto(0)

    def _reflow(self, width: int):
        cols = self._cols(width or 400)
        for i, vid_id in enumerate(self._order):
            card = self._cards.get(vid_id)
            if card:
                card.grid(row=i // cols, column=i % cols, padx=PAD // 2, pady=PAD // 2)

    def _make_card(self, v: dict) -> tk.Frame:
        vid_id   = v['id']
        name     = v.get('name', '')
        is_link  = v.get('isLink', False)
        category = v.get('category', '')
        selected = vid_id in self._selected

        outer = tk.Frame(self._inner, bg=AC if selected else BRD,
                         padx=2, pady=2, cursor='hand2')
        inner = tk.Frame(outer, bg=BG3, width=CARD_W - 4)
        inner.pack(fill='both', expand=True)
        inner.pack_propagate(False)

        # Thumbnail area
        thumb_frame = tk.Frame(inner, bg='#111', width=CARD_W - 4, height=THUMB_H)
        thumb_frame.pack(fill='x')
        thumb_frame.pack_propagate(False)

        if HAS_PIL:
            img_label = tk.Label(thumb_frame, bg='#111', cursor='hand2')
            img_label.place(relwidth=1, relheight=1)
            def on_ready(vid, photo, lbl=img_label):
                try:
                    lbl.config(image=photo)
                    lbl.image = photo
                except tk.TclError:
                    pass
            get_or_load_thumb(vid_id, lambda vid, ph, cb=on_ready: self.after(0, cb, vid, ph))
            img_label.bind('<Button-1>', lambda e, i=vid_id: self._click(e, i))
        else:
            play_lbl = tk.Label(thumb_frame, text='▶', bg='#111', fg=TX3, font=('', 18))
            play_lbl.place(relx=0.5, rely=0.5, anchor='center')

        if is_link:
            tk.Label(thumb_frame, text='link', bg='#00000099', fg=TX3,
                     font=('', 7), padx=3).place(x=3, y=3)

        # Name label
        short_name = re.sub(r'\.[^.]+$', '', name)
        name_lbl = tk.Label(inner, text=short_name, bg=BG3,
                            fg=TX if selected else TX2,
                            font=('', 9), anchor='w', wraplength=CARD_W - 10,
                            justify='left', padx=4, pady=3)
        name_lbl.pack(fill='x')

        # Bind clicks on all child widgets
        for widget in (outer, inner, thumb_frame, name_lbl):
            widget.bind('<Button-1>', lambda e, i=vid_id: self._click(e, i))

        return outer

    def _click(self, event, vid_id: str):
        shift = bool(event.state & 0x0001)
        if shift:
            # Range select from last clicked to this
            if self._order:
                try:
                    last = next((i for i, x in enumerate(self._order) if x in self._selected), 0)
                    cur  = self._order.index(vid_id)
                    lo, hi = sorted([last, cur])
                    for oid in self._order[lo:hi+1]:
                        self._selected.add(oid)
                except (ValueError, StopIteration):
                    self._selected.add(vid_id)
        else:
            if vid_id in self._selected:
                self._selected.discard(vid_id)
            else:
                self._selected.add(vid_id)
        self._refresh_card(vid_id)
        self.on_select(vid_id, shift)

    def _refresh_card(self, vid_id: str):
        card = self._cards.get(vid_id)
        if not card:
            return
        selected = vid_id in self._selected
        card.config(bg=AC if selected else BRD)
        # Update name label colour
        for w in card.winfo_children():
            for ww in w.winfo_children():
                if isinstance(ww, tk.Label) and ww.cget('anchor') == 'w':
                    ww.config(fg=TX if selected else TX2)

    def get_selected(self) -> Set[str]:
        return set(self._selected)

    def set_selected(self, ids: Set[str]):
        old = self._selected
        self._selected = set(ids)
        for vid_id in old | ids:
            self._refresh_card(vid_id)

    def clear_selection(self):
        old = set(self._selected)
        self._selected.clear()
        for vid_id in old:
            self._refresh_card(vid_id)


# ── Panel (one side of the categorizer) ──────────────────────────────────────

class Panel(tk.Frame):
    """One half of the categorizer — category selector + video grid."""

    def __init__(self, master, all_videos: List[dict], categories: List[dict],
                 on_selection_change, border_left=False, **kw):
        super().__init__(master, bg=BG2, **kw)
        self._all_videos   = all_videos
        self._categories   = categories
        self._on_sel_chg   = on_selection_change
        self._cat_var      = tk.StringVar()
        self._search_var   = tk.StringVar()
        self._source_var   = tk.StringVar(value='both')
        self._extra_cats: List[dict] = []

        if border_left:
            self.config(relief='flat', bd=0,
                        highlightbackground=BRD, highlightthickness=1)

        self._build_header()
        self._build_toolbar()
        self._build_sel_bar()
        self._grid = VideoGrid(self, on_select=self._on_card_click)
        self._grid.pack(fill='both', expand=True)

        self._search_var.trace_add('write', lambda *_: self._refresh())
        self._cat_var.trace_add('write', lambda *_: self._refresh())
        self._refresh()

    # ── Build UI ──────────────────────────────────────────────────────────────

    def _build_header(self):
        hdr = tk.Frame(self, bg=BG2)
        hdr.pack(fill='x')

        self._cat_combo = ttk.Combobox(hdr, textvariable=self._cat_var,
                                       state='readonly', font=('', 10))
        self._cat_combo.pack(side='left', fill='x', expand=True, padx=6, pady=5)
        self._cat_combo.bind('<<ComboboxSelected>>', lambda _: self._refresh())
        self._refresh_cat_list()

        btn_style = dict(bg=BG3, fg=TX3, activebackground=BG3,
                         relief='flat', bd=0, padx=5, pady=2,
                         cursor='hand2', font=('', 10))

        tk.Button(hdr, text='✎', **btn_style,
                  command=self._rename_folder).pack(side='left', padx=1)
        tk.Button(hdr, text='🗑', **{**btn_style, 'fg': '#cc4444'},
                  command=self._delete_folder).pack(side='left', padx=1)
        tk.Button(hdr, text='+', **btn_style,
                  command=self._create_folder).pack(side='left', padx=(1, 6))   
        self._count_lbl = tk.Label(hdr, text='0', bg=BG2, fg=TX3, font=('', 9))
        self._count_lbl.pack(side='right', padx=6)

    def _build_toolbar(self):
        bar = tk.Frame(self, bg=BG3)
        bar.pack(fill='x')

        tk.Label(bar, text='⌕', bg=BG3, fg=TX3, font=('', 11)).pack(side='left', padx=(6, 2))
        self._search_entry = tk.Entry(bar, textvariable=self._search_var,
                                      bg=BG3, fg=TX, insertbackground=TX,
                                      relief='flat', bd=0, font=('', 10))
        self._search_entry.pack(side='left', fill='x', expand=True, pady=5)

        clear_btn = tk.Label(bar, text='✕', bg=BG3, fg=TX3, cursor='hand2', font=('', 10))
        clear_btn.pack(side='left', padx=3)
        clear_btn.bind('<Button-1>', lambda _: self._search_var.set(''))

        for label, val in (('Both', 'both'), ('Local', 'local'), ('Links', 'remote')):
            b = tk.Button(bar, text=label, font=('', 8),
                          bg=BG3, fg=TX3, relief='flat', bd=0, padx=5, pady=2,
                          cursor='hand2', activebackground=BG3)
            b.pack(side='left', padx=1)
            b.bind('<Button-1>', lambda e, v=val, btn=b: self._set_source(v))
            setattr(self, f'_src_btn_{val}', b)

        self._update_src_btns()
        tk.Frame(bar, width=4, bg=BG3).pack(side='right')

    def _build_sel_bar(self):
        bar = tk.Frame(self, bg=BG3)
        bar.pack(fill='x')
        tk.Frame(self, bg=BRD, height=1).pack(fill='x')

        btn_s = dict(bg=BG2, fg=TX2, relief='flat', bd=0,
                     padx=5, pady=2, cursor='hand2', font=('', 8),
                     activebackground=BG3)

        tk.Button(bar, text='All',  **btn_s, command=self._sel_all).pack(side='left', padx=(4, 1), pady=3)
        tk.Button(bar, text='None', **btn_s, command=self._sel_none).pack(side='left', padx=1, pady=3)

        self._sel_lbl = tk.Label(bar, text='', bg=BG3, fg=AC, font=('', 9, 'bold'))
        self._sel_lbl.pack(side='left', padx=6)

    # ── Category helpers ──────────────────────────────────────────────────────

    def _all_cats(self) -> List[dict]:
        merged = list(self._categories)
        existing_paths = {c['path'] for c in merged}
        for ec in self._extra_cats:
            if ec['path'] not in existing_paths:
                merged.append(ec)
        return [c for c in merged if c.get('path') != 'uncategorized']

    def _refresh_cat_list(self):
        cats = self._all_cats()
        values = ['— Uncategorized —'] + [c['name'] for c in cats]
        self._cat_combo['values'] = values
        cur = self._cat_var.get()
        if cur not in values:
            self._cat_var.set(values[0] if values else '')

    def update_categories(self, cats: List[dict]):
        self._categories = cats
        self._refresh_cat_list()

    def update_all_videos(self, videos: List[dict]):
        self._all_videos = videos
        self._refresh()

    def _cat_path(self) -> str:
        name = self._cat_var.get()
        if not name or name.startswith('—'):
            return ''
        for c in self._all_cats():
            if c['name'] == name:
                return c['path']
        return name

    # ── Video filtering (mirrors TSX panelVideos) ─────────────────────────────

    def _filtered_videos(self, exclude_ids: Set[str] = None) -> List[dict]:
        q      = self._search_var.get().strip().lower()
        source = self._source_var.get()
        cat    = self._cat_path()

        if q:
            vids = [v for v in self._all_videos
                    if fuzzy_match(v.get('name', ''), q)
                    or fuzzy_match(v.get('catPath', ''), q)
                    or fuzzy_match(v.get('category', ''), q)]
        elif cat:
            vids = [v for v in self._all_videos if (v.get('catPath') or '') == cat]
        else:
            vids = []

        if source == 'local':
            vids = [v for v in vids if not v.get('isLink')]
        elif source == 'remote':
            vids = [v for v in vids if v.get('isLink')]

        if exclude_ids:
            vids = [v for v in vids if v['id'] not in exclude_ids]

        return vids

    def get_visible_videos(self) -> List[dict]:
        return self._filtered_videos()

    # ── Refresh grid ──────────────────────────────────────────────────────────

    def _refresh(self, exclude_ids: Set[str] = None):
        vids = self._filtered_videos(exclude_ids)
        sel  = self._grid.get_selected()
        sel  = sel & {v['id'] for v in vids}
        self._grid.populate(vids, sel)
        self._count_lbl.config(text=str(len(vids)))
        self._update_sel_label()

    def _update_sel_label(self):
        n = len(self._grid.get_selected())
        self._sel_lbl.config(text=f'{n} selected' if n else '')

    def _update_src_btns(self):
        src = self._source_var.get()
        for val in ('both', 'local', 'remote'):
            btn = getattr(self, f'_src_btn_{val}', None)
            if btn:
                btn.config(bg=AC if src == val else BG3,
                           fg='white' if src == val else TX3)

    def _set_source(self, val: str):
        self._source_var.set(val)
        self._update_src_btns()
        self._grid.clear_selection()
        self._refresh()

    def _sel_all(self):
        vids = self._filtered_videos()
        self._grid.set_selected({v['id'] for v in vids})
        self._update_sel_label()
        self._on_sel_chg()

    def _sel_none(self):
        self._grid.clear_selection()
        self._update_sel_label()
        self._on_sel_chg()

    def _on_card_click(self, vid_id: str, shift: bool):
        self._update_sel_label()
        self._on_sel_chg()

    # ── Folder operations ─────────────────────────────────────────────────────

    def _create_folder(self):
        name = simpledialog.askstring('New Folder', 'Folder name:', parent=self)
        if not name:
            return
        name = name.strip().strip('/')
        if not name:
            return
        try:
            api_post('/api/main-categories', {'name': name})
        except Exception as e:
            messagebox.showerror('Error', str(e), parent=self)
            return
        self._extra_cats.append({'name': name, 'path': name})
        self._refresh_cat_list()
        # Select the new folder
        self._cat_var.set(name)
        self._refresh()

    def _rename_folder(self):
        old_path = self._cat_path()
        if not old_path:
            messagebox.showinfo('Rename', 'Select a folder first.', parent=self)
            return
        old_leaf = old_path.split('/')[-1]
        new_name = simpledialog.askstring('Rename Folder', 'New name:',
                                          initialvalue=old_leaf, parent=self)
        if not new_name:
            return
        new_name = re.sub(r'[<>:"/\\|?*]', '_', new_name.strip())
        try:
            r = api_patch('/api/categories/rename', {'oldPath': old_path, 'newName': new_name})
            if r.get('error'):
                messagebox.showerror('Error', r['error'], parent=self)
                return
        except Exception as e:
            messagebox.showerror('Error', str(e), parent=self)
            return

        parts = old_path.split('/')
        parts[-1] = new_name
        new_path = '/'.join(parts)
        for v in self._all_videos:
            if (v.get('catPath') or '').startswith(old_path):
                v['catPath'] = (v.get('catPath') or '').replace(old_path, new_path)
                v['category'] = (v.get('category') or '').replace(old_leaf, new_name)
        self._cat_var.set(new_path)
        self._refresh_cat_list()
        self._refresh()

    def _delete_folder(self):
        cat = self._cat_path()
        if not cat:
            messagebox.showinfo('Delete', 'Select a folder first.', parent=self)
            return
        if not messagebox.askyesno('Delete Folder',
                f'Delete "{cat}"? All videos will move to the default folder.',
                parent=self):
            return
        try:
            r = api_delete('/api/categories/delete', {'path': cat})
            if r.get('error'):
                messagebox.showerror('Error', r['error'], parent=self)
                return
        except Exception as e:
            messagebox.showerror('Error', str(e), parent=self)
            return
        self._cat_var.set('— Uncategorized —')
        self._refresh_cat_list()
        self._refresh()

    # ── Public interface ──────────────────────────────────────────────────────

    def get_selected_ids(self) -> Set[str]:
        return self._grid.get_selected()

    def clear_selection(self):
        self._grid.clear_selection()
        self._update_sel_label()

    def get_target_cat(self) -> str:
        return self._cat_path()

    def remove_videos(self, ids: Set[str]):
        for v in self._all_videos:
            if v['id'] in ids:
                v['_hidden'] = True
        self._refresh()


# ── Categorizer tab ───────────────────────────────────────────────────────────

class CategorizerTab(tk.Frame):

    def __init__(self, master, **kw):
        super().__init__(master, bg=BG, **kw)
        self._videos: List[dict]    = []
        self._categories: List[dict] = []

        self._status = tk.StringVar(value='Loading…')
        tk.Label(self, textvariable=self._status, bg=BG, fg=TX3,
                 font=('', 9)).pack(side='bottom', fill='x', padx=6, pady=2)

        body = tk.Frame(self, bg=BG)
        body.pack(fill='both', expand=True)

        self._left  = Panel(body, [], [], self._on_sel_change)
        self._right = Panel(body, [], [], self._on_sel_change, border_left=True)
        self._left.pack(side='left', fill='both', expand=True)
        self._right.pack(side='right', fill='both', expand=True)

        self._build_mid_bar()
        self._load_data()

    def _build_mid_bar(self):
        mid = tk.Frame(self, bg=BG2)
        mid.pack(side='bottom', fill='x')

        btn_s = dict(relief='flat', bd=0, padx=12, pady=5, cursor='hand2',
                     font=('', 10, 'bold'), activebackground=BG3)

        self._move_lr = tk.Button(mid, text='Move →', bg=BG3, fg=TX2, **btn_s,
                                  command=lambda: self._move('left', 'right'))
        self._move_lr.pack(side='left', padx=6, pady=5)

        self._move_rl = tk.Button(mid, text='← Move', bg=BG3, fg=TX2, **btn_s,
                                  command=lambda: self._move('right', 'left'))
        self._move_rl.pack(side='left', padx=2, pady=5)

        tk.Button(mid, text='⟳ Refresh', bg=BG3, fg=TX3, **btn_s,
                  command=self._load_data).pack(side='right', padx=6, pady=5)

    def _on_sel_change(self):
        ln = len(self._left.get_selected_ids())
        rn = len(self._right.get_selected_ids())
        self._move_lr.config(fg=TX if ln else TX3)
        self._move_rl.config(fg=TX if rn else TX3)

    def _load_data(self):
        self._status.set('Loading…')
        threading.Thread(target=self._fetch_bg, daemon=True).start()

    def _fetch_bg(self):
        try:
            videos = api_get('/api/videos')
            cats   = api_get('/api/categories')
            self.after(0, self._on_data, videos, cats)
        except Exception as e:
            self.after(0, self._status.set, f'Error: {e}')

    def _on_data(self, videos, cats):
        self._videos     = videos if isinstance(videos, list) else []
        self._categories = cats   if isinstance(cats,   list) else []
        self._left.update_all_videos(self._videos)
        self._left.update_categories(self._categories)
        self._right.update_all_videos(self._videos)
        self._right.update_categories(self._categories)
        self._status.set(f'{len(self._videos)} videos · {len(self._categories)} categories')

    def _move(self, from_side: str, to_side: str):
        src   = self._left  if from_side == 'left' else self._right
        dst   = self._left  if to_side   == 'left' else self._right
        ids   = src.get_selected_ids()
        if not ids:
            return
        target_cat = dst.get_target_cat()
        if not messagebox.askyesno(
                'Move',
                f'Move {len(ids)} video(s) to "{target_cat or "Uncategorized"}"?',
                parent=self):
            return

        self._status.set('Moving…')
        threading.Thread(target=self._move_bg,
                         args=(list(ids), target_cat, from_side),
                         daemon=True).start()

    def _move_bg(self, ids: List[str], target_cat: str, from_side: str):
        failures = 0
        id_map: Dict[str, str] = {}
        for vid_id in ids:
            v = next((x for x in self._videos if x['id'] == vid_id), None)
            if not v:
                continue
            try:
                if v.get('isLink'):
                    api_patch('/api/links/move',
                              {'urls': [v.get('linkUrl') or v.get('relPath')],
                               'category': target_cat})
                else:
                    r = api_patch(f'/api/videos/{urllib.parse.quote(vid_id, safe="")}/move',
                                  {'category': target_cat})
                    if r.get('ok') and r.get('newId'):
                        id_map[vid_id] = r['newId']
                    elif not r.get('ok'):
                        failures += 1
            except Exception:
                failures += 1

        self.after(0, self._on_move_done, ids, id_map, target_cat, from_side, failures)

    def _on_move_done(self, ids: List[str], id_map: Dict[str, str],
                      target_cat: str, from_side: str, failures: int):
        id_set  = set(ids)
        cat_obj = next((c for c in self._categories if c['path'] == target_cat), None)
        cat_name = cat_obj['name'] if cat_obj else target_cat or 'Uncategorized'

        for v in self._videos:
            if v['id'] in id_map:
                v['id']      = id_map[v['id']]
                v['catPath'] = target_cat
                v['category'] = cat_name
            elif v['id'] in id_set and v.get('isLink'):
                v['catPath'] = target_cat
                v['category'] = cat_name

        self._left.update_all_videos(self._videos)
        self._right.update_all_videos(self._videos)

        if failures:
            messagebox.showerror('Move', f'{failures} move(s) failed.', parent=self)

        moved = len(ids) - failures
        self._status.set(f'Moved {moved} video(s) to "{cat_name}".')


# ── Duplicate finder tab ──────────────────────────────────────────────────────

class DuplicatesTab(tk.Frame):

    def __init__(self, master, **kw):
        super().__init__(master, bg=BG, **kw)
        self._groups: List[List[dict]] = []
        self._videos: List[dict] = []
        self._build_ui()

    def _build_ui(self):
        top = tk.Frame(self, bg=BG2)
        top.pack(fill='x', pady=(0, 2))

        tk.Label(top, text='Duplicate Finder', bg=BG2, fg=TX,
                 font=('', 12, 'bold')).pack(side='left', padx=10, pady=8)

        btn_s = dict(relief='flat', bd=0, padx=10, pady=4,
                     cursor='hand2', font=('', 9))

        self._scan_btn = tk.Button(top, text='Server Scan (visual hash)',
                                   bg=AC, fg='white', **btn_s,
                                   command=self._server_scan)
        self._scan_btn.pack(side='left', padx=6, pady=6)

        tk.Button(top, text='Local Scan (name + size)',
                  bg=BG3, fg=TX2, **btn_s,
                  command=self._local_scan).pack(side='left', padx=2, pady=6)

        self._progress = tk.StringVar(value='')
        self._prog_bar = ttk.Progressbar(top, mode='indeterminate', length=120)
        self._prog_lbl = tk.Label(top, textvariable=self._progress, bg=BG2, fg=TX3, font=('', 9))
        self._prog_bar.pack(side='left', padx=8, pady=8)
        self._prog_lbl.pack(side='left', padx=2)

        # Results area
        results_frame = tk.Frame(self, bg=BG)
        results_frame.pack(fill='both', expand=True)

        self._canvas = tk.Canvas(results_frame, bg=BG, highlightthickness=0)
        sb = ttk.Scrollbar(results_frame, orient='vertical', command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=sb.set)
        sb.pack(side='right', fill='y')
        self._canvas.pack(side='left', fill='both', expand=True)

        self._inner = tk.Frame(self._canvas, bg=BG)
        self._win   = self._canvas.create_window((0, 0), window=self._inner, anchor='nw')

        self._inner.bind('<Configure>',
                         lambda _: self._canvas.configure(scrollregion=self._canvas.bbox('all')))
        self._canvas.bind('<Configure>',
                          lambda e: self._canvas.itemconfig(self._win, width=e.width))
        self._canvas.bind('<MouseWheel>',
                          lambda e: self._canvas.yview_scroll(int(-e.delta / 120), 'units'))

        self._status = tk.Label(self, text='Run a scan to find duplicates.',
                                bg=BG, fg=TX3, font=('', 9))
        self._status.pack(side='bottom', fill='x', padx=8, pady=4)

    # ── Server scan ───────────────────────────────────────────────────────────

    def _server_scan(self):
        self._prog_bar.start(10)
        self._progress.set('Starting scan…')
        self._scan_btn.config(state='disabled')
        threading.Thread(target=self._server_scan_bg, daemon=True).start()

    def _server_scan_bg(self):
        try:
            api_post('/api/duplicates/scan')
        except Exception as e:
            self.after(0, self._scan_error, str(e))
            return
        self._poll_server_scan()

    def _poll_server_scan(self):
        try:
            status = api_get('/api/duplicates/status')
        except Exception as e:
            self.after(0, self._scan_error, str(e))
            return
        running = status.get('running', False)
        done    = status.get('done', 0)
        total   = status.get('total', 0)
        msg     = f'Scanning… {done}/{total}' if total else 'Scanning…'
        self.after(0, self._progress.set, msg)
        if running:
            threading.Timer(1.0, self._poll_server_scan).start()
        else:
            self._fetch_server_results()

    def _fetch_server_results(self):
        try:
            groups = api_get('/api/duplicates/results')
            self.after(0, self._on_results, groups, 'server')
        except Exception as e:
            self.after(0, self._scan_error, str(e))

    # ── Local scan ────────────────────────────────────────────────────────────

    def _local_scan(self):
        # Ask for videos directory
        import tkinter.filedialog as fd
        folder = fd.askdirectory(title='Select your videos folder', parent=self)
        if not folder:
            return
        self._prog_bar.start(10)
        self._progress.set('Scanning…')
        threading.Thread(target=self._local_scan_bg, args=(folder,), daemon=True).start()

    def _local_scan_bg(self, folder: str):
        VIDEO_EXTS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv',
                      '.webm', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg'}
        files = []
        for root, dirs, names in os.walk(folder):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('hidden', 'Z')]
            for name in names:
                if os.path.splitext(name)[1].lower() in VIDEO_EXTS:
                    full = os.path.join(root, name)
                    try:
                        size = os.path.getsize(full)
                    except OSError:
                        size = 0
                    files.append({'path': full, 'name': name, 'size': size})

        self.after(0, self._progress.set, f'Comparing {len(files)} files…')
        groups = self._find_local_dupes(files)
        self.after(0, self._on_local_results, groups)

    def _find_local_dupes(self, files: List[dict]) -> List[List[dict]]:
        used   = set()
        groups = []
        for i, a in enumerate(files):
            if i in used:
                continue
            group = [a]
            for j, b in enumerate(files[i+1:], start=i+1):
                if j in used:
                    continue
                name_sim  = difflib.SequenceMatcher(
                    None,
                    os.path.splitext(a['name'])[0].lower(),
                    os.path.splitext(b['name'])[0].lower()).ratio()
                size_sim  = abs(a['size'] - b['size']) < 5 * 1024 * 1024  # within 5 MB
                exact_size = a['size'] == b['size'] and a['size'] > 0
                if exact_size or (name_sim > 0.85 and size_sim):
                    group.append(b)
                    used.add(j)
            if len(group) > 1:
                used.add(i)
                groups.append(group)
        return groups

    def _on_local_results(self, groups: List[List[dict]]):
        self._prog_bar.stop()
        self._progress.set('')
        self._scan_btn.config(state='normal')
        for w in self._inner.winfo_children():
            w.destroy()

        if not groups:
            self._status.config(text='No duplicates found.')
            return

        self._status.config(text=f'{len(groups)} duplicate group(s) found.')
        for g in groups:
            self._render_local_group(g)

    def _render_local_group(self, group: List[dict]):
        frame = tk.LabelFrame(self._inner, bg=BG2, fg=TX2,
                              text=f'Group ({len(group)} files)',
                              font=('', 9), padx=6, pady=4, bd=1, relief='flat',
                              highlightbackground=BRD, highlightthickness=1)
        frame.pack(fill='x', padx=8, pady=4)

        for item in group:
            row = tk.Frame(frame, bg=BG2)
            row.pack(fill='x', pady=1)
            size_mb = item['size'] / (1024 * 1024)
            tk.Label(row, text=item['path'], bg=BG2, fg=TX2,
                     font=('', 8), anchor='w', wraplength=600,
                     justify='left').pack(side='left', fill='x', expand=True)
            tk.Label(row, text=f'{size_mb:.1f} MB', bg=BG2, fg=TX3,
                     font=('', 8)).pack(side='right', padx=4)
            tk.Button(row, text='Delete', bg='#3a1010', fg='#ff6666',
                      relief='flat', bd=0, padx=6, pady=1, font=('', 8),
                      cursor='hand2',
                      command=lambda p=item['path'], r=row: self._delete_local(p, r)
                      ).pack(side='right', padx=4)

    def _delete_local(self, path: str, row: tk.Frame):
        if not messagebox.askyesno('Delete', f'Permanently delete:\n{path}?', parent=self):
            return
        try:
            os.remove(path)
            row.destroy()
        except Exception as e:
            messagebox.showerror('Error', str(e), parent=self)

    # ── Server results renderer ───────────────────────────────────────────────

    def _on_results(self, groups: List[List[dict]], source: str):
        self._groups = groups
        self._prog_bar.stop()
        self._progress.set('')
        self._scan_btn.config(state='normal')
        for w in self._inner.winfo_children():
            w.destroy()

        if not groups:
            self._status.config(text='No duplicates found.')
            return

        self._status.config(text=f'{len(groups)} duplicate group(s) — {source} scan.')
        for g in groups:
            self._render_server_group(g)

    def _render_server_group(self, group: List[dict]):
        frame = tk.LabelFrame(self._inner, bg=BG2, fg=TX2,
                              text=f'Group ({len(group)} videos)',
                              font=('', 9), padx=6, pady=4, bd=1, relief='flat',
                              highlightbackground=BRD, highlightthickness=1)
        frame.pack(fill='x', padx=8, pady=4)

        card_row = tk.Frame(frame, bg=BG2)
        card_row.pack(fill='x')

        for v in group:
            vid_id   = v.get('id', '')
            name     = v.get('name', vid_id)
            category = v.get('category', 'Uncategorized')
            size_mb  = v.get('size', 0) / (1024 * 1024)

            card = tk.Frame(card_row, bg=BG3, width=CARD_W, bd=1,
                            highlightbackground=BRD, highlightthickness=1)
            card.pack(side='left', padx=4, pady=4)
            card.pack_propagate(False)

            # Thumbnail
            thumb_frame = tk.Frame(card, bg='#111', width=CARD_W, height=THUMB_H)
            thumb_frame.pack(fill='x')
            thumb_frame.pack_propagate(False)

            if HAS_PIL:
                img_label = tk.Label(thumb_frame, bg='#111')
                img_label.place(relwidth=1, relheight=1)
                def on_ready(vid, photo, lbl=img_label):
                    try:
                        lbl.config(image=photo)
                        lbl.image = photo
                    except tk.TclError:
                        pass
                get_or_load_thumb(vid_id,
                                  lambda vid, ph, cb=on_ready: self.after(0, cb, vid, ph))

            tk.Label(card, text=re.sub(r'\.[^.]+$', '', name),
                     bg=BG3, fg=TX2, font=('', 8), wraplength=CARD_W - 8,
                     justify='left', anchor='w').pack(fill='x', padx=3, pady=1)
            tk.Label(card, text=f'{category} · {size_mb:.1f} MB',
                     bg=BG3, fg=TX3, font=('', 7)).pack(fill='x', padx=3)

            del_btn = tk.Button(card, text='Delete from server',
                                bg='#3a1010', fg='#ff6666',
                                relief='flat', bd=0, padx=4, pady=2, font=('', 7),
                                cursor='hand2',
                                command=lambda i=vid_id, c=card: self._delete_server(i, c))
            del_btn.pack(pady=(2, 4))

    def _delete_server(self, vid_id: str, card: tk.Frame):
        if not messagebox.askyesno('Delete', 'Delete this video from the server?',
                                   parent=self):
            return
        try:
            api_delete(f'/api/videos/{urllib.parse.quote(vid_id, safe="")}', {})
            card.destroy()
        except Exception as e:
            messagebox.showerror('Error', str(e), parent=self)

    def _scan_error(self, msg: str):
        self._prog_bar.stop()
        self._progress.set('')
        self._scan_btn.config(state='normal')
        messagebox.showerror('Scan Error', msg, parent=self)


# ── Main app ──────────────────────────────────────────────────────────────────

class App(tk.Tk):

    def __init__(self):
        super().__init__()
        self.title(f'AphroArchive Categorizer — {SERVER}')
        self.geometry('1200x750')
        self.minsize(800, 500)
        self.configure(bg=BG)

        if not HAS_PIL:
            tk.Label(self, text='pip install pillow  to enable thumbnails',
                     bg='#2a1a00', fg='#ffaa44', font=('', 9),
                     padx=6, pady=3).pack(fill='x')

        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('TNotebook',         background=BG2,  borderwidth=0)
        style.configure('TNotebook.Tab',     background=BG3,  foreground=TX3,
                         padding=[12, 5],    font=('', 10))
        style.map('TNotebook.Tab',
                  background=[('selected', BG)],
                  foreground=[('selected', TX)])
        style.configure('TCombobox', fieldbackground=BG3, background=BG3,
                         foreground=TX, selectbackground=BG3)
        style.configure('Vertical.TScrollbar', background=BG3,
                         troughcolor=BG2, borderwidth=0)

        nb = ttk.Notebook(self)
        nb.pack(fill='both', expand=True, padx=0, pady=0)

        self._cat_tab  = CategorizerTab(nb)
        self._dupl_tab = DuplicatesTab(nb)

        nb.add(self._cat_tab,  text='  Categorizer  ')
        nb.add(self._dupl_tab, text='  Duplicates   ')


def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
