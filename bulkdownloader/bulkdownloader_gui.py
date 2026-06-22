#!/usr/bin/env python3
"""GUI download manager for bulkdownloader.py.

Paste a list of video page URLs and manage them as a download queue:
start, pause, resume, stop and remove/retry individual items. Each URL
is downloaded by its own `bulkdownloader.py --url …` subprocess, so a
paused/stopped item resumes from its partial `.part` file on the next run.

There is no categorization here — files land in the chosen output folder.
"""

import os
import re
import sys
import shutil
import queue
import threading
import subprocess
import itertools
import tkinter as tk
from pathlib import Path
from tkinter import ttk, filedialog, messagebox

# ── path resolution (works both as a plain script and as a frozen exe) ──

FROZEN = getattr(sys, 'frozen', False)
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent

if FROZEN:
    # bulkdownloader.py is bundled as data alongside the frozen exe.
    SCRIPT_PATH = Path(getattr(sys, '_MEIPASS', APP_DIR)) / 'bulkdownloader.py'
else:
    SCRIPT_PATH = APP_DIR / 'bulkdownloader.py'


def _find_project_root():
    for base in (APP_DIR, APP_DIR.parent, APP_DIR.parent.parent):
        if (base / 'server').is_dir() or (base / 'videos').is_dir():
            return base
    return APP_DIR.parent if APP_DIR.parent.exists() else APP_DIR


PROJECT_ROOT = _find_project_root()
VIDEOS_ROOT = PROJECT_ROOT / 'videos'
DEFAULT_OUT_DIR = VIDEOS_ROOT / 'downloads'

LINKS_TO_DOWNLOAD = APP_DIR / 'links_to_download.txt'
LINKS_DOWNLOADED = APP_DIR / 'links_downloaded.txt'

# Per-item subprocess output: "   [download]  45.3% of 120.4MiB at … ETA …"
PROGRESS_RE = re.compile(r'\[download\]\s+([\d.]+)%')
TITLE_RE = re.compile(r'\[title\]\s+"(.+)"')

# ── palette ──────────────────────────────────────────────────────────
BG = '#f3f4f6'
PANEL_BG = '#ffffff'
ACCENT = '#2563eb'
ACCENT_ACTIVE = '#1d4ed8'
SUCCESS = '#16a34a'
ERROR = '#dc2626'
MUTED = '#6b7280'
BORDER = '#d1d5db'
LOG_BG = '#1e1e1e'
LOG_FG = '#d4d4d4'

# Pick fonts that actually exist on the host OS — Segoe UI/Consolas are
# Windows-only and fall back to ugly defaults on macOS/Linux.
if sys.platform == 'darwin':
    _UI_FONT, _MONO_FONT = 'Helvetica Neue', 'Menlo'
elif sys.platform == 'win32':
    _UI_FONT, _MONO_FONT = 'Segoe UI', 'Consolas'
else:
    _UI_FONT, _MONO_FONT = 'DejaVu Sans', 'DejaVu Sans Mono'

FONT = (_UI_FONT, 10)
FONT_BOLD = (_UI_FONT, 10, 'bold')
FONT_HEADER = (_UI_FONT, 15, 'bold')
FONT_SUB = (_UI_FONT, 9)
FONT_MONO = (_MONO_FONT, 9)

# ── item status labels ───────────────────────────────────────────────
ST_QUEUED = 'queued'
ST_DOWNLOADING = 'downloading'
ST_DONE = 'done'
ST_ERROR = 'error'
ST_STOPPED = 'stopped'

STATUS_LABEL = {
    ST_QUEUED: '⏳ Queued',
    ST_DOWNLOADING: '⬇ Downloading',
    ST_DONE: '✅ Done',
    ST_ERROR: '❌ Error',
    ST_STOPPED: '⏸ Stopped',
}


def _python_bin():
    """Interpreter used to run bulkdownloader.py."""
    if not FROZEN:
        return sys.executable
    for name in ('python', 'python3'):
        found = shutil.which(name)
        if found:
            return found
    return 'python'


def _ensure_link_files():
    for path in (LINKS_TO_DOWNLOAD, LINKS_DOWNLOADED):
        if not path.exists():
            path.touch()


def _read_link_lines(path):
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]


def _write_link_lines(path, lines):
    path.write_text('\n'.join(lines) + '\n' if lines else '', encoding='utf-8')


def _remove_link(path, url):
    lines = _read_link_lines(path)
    if url in lines:
        _write_link_lines(path, [u for u in lines if u != url])


def _append_link(path, url):
    lines = _read_link_lines(path)
    if url not in lines:
        lines.append(url)
        _write_link_lines(path, lines)


def _prepend_links(path, urls):
    """Add *urls* to the TOP of *path*, preserving their order and skipping any
    already present. Newly pasted links land first so they download first."""
    new = [u for u in dict.fromkeys(urls) if u]
    if not new:
        return
    existing = _read_link_lines(path)
    existing_set = set(existing)
    new = [u for u in new if u not in existing_set]
    if new:
        _write_link_lines(path, new + existing)


def _read_stream(stream):
    """Yield output split on both \\n and \\r so yt-dlp's carriage-return
    progress updates surface immediately instead of only on newline."""
    buf = []
    while True:
        ch = stream.read(1)
        if not ch:
            if buf:
                yield ''.join(buf)
            return
        if ch in ('\r', '\n'):
            if buf:
                yield ''.join(buf)
                buf = []
        else:
            buf.append(ch)


class DownloadManager(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('AphroArchive — Download Manager')
        self.geometry('960x680')
        self.minsize(720, 480)
        self.configure(bg=BG)

        _ensure_link_files()

        self._ids = itertools.count(1)
        self.items = {}                 # iid -> {url, status, pct, file, title}
        self.out_queue = queue.Queue()  # worker -> UI messages

        self.current_proc = None
        self.is_running = False          # worker actively processing the queue
        self._stop_requested = False     # terminate current + halt loop

        self.out_dir = tk.StringVar(value=str(DEFAULT_OUT_DIR))
        self.status_var = tk.StringVar(value='Idle')
        self.overall_var = tk.StringVar(value='')

        self._setup_style()
        self._build_ui()
        self.after(100, self._poll_queue)
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ── styling ──────────────────────────────────────────────────────
    def _setup_style(self):
        style = ttk.Style(self)
        try:
            style.theme_use('clam')
        except tk.TclError:
            pass

        style.configure('.', background=BG, font=FONT)
        style.configure('TFrame', background=BG)
        style.configure('TLabelframe', background=BG, bordercolor=BORDER)
        style.configure('TLabelframe.Label', background=BG, font=FONT_BOLD, foreground='#374151')
        style.configure('TLabel', background=BG, font=FONT)

        style.configure('TButton', font=FONT, padding=(10, 5))
        style.configure('Accent.TButton', font=FONT_BOLD, padding=(12, 6),
                        background=ACCENT, foreground='white')
        style.map('Accent.TButton',
                  background=[('active', ACCENT_ACTIVE), ('disabled', '#93b6f8')],
                  foreground=[('disabled', '#e5e7eb')])

        style.configure('Stop.TButton', font=FONT_BOLD, padding=(12, 6),
                        background=ERROR, foreground='white')
        style.map('Stop.TButton',
                  background=[('active', '#b91c1c'), ('disabled', '#f3a1a1')],
                  foreground=[('disabled', '#fde8e8')])

        style.configure('Header.TLabel', font=FONT_HEADER, background=BG, foreground='#111827')
        style.configure('Sub.TLabel', font=FONT_SUB, background=BG, foreground=MUTED)
        style.configure('Status.TLabel', font=FONT, background=BG, foreground='#374151')
        style.configure('Count.TLabel', font=FONT_SUB, background=BG, foreground=MUTED)

        style.configure('TEntry', padding=4)
        style.configure('TProgressbar', thickness=14, background=ACCENT)

        style.configure('Treeview', font=FONT, rowheight=26, background=PANEL_BG,
                        fieldbackground=PANEL_BG, bordercolor=BORDER)
        style.configure('Treeview.Heading', font=FONT_BOLD, padding=(6, 4))
        style.map('Treeview', background=[('selected', '#dbeafe')], foreground=[('selected', '#111827')])

    # ── UI layout ─────────────────────────────────────────────────────
    def _build_ui(self):
        pad = {'padx': 12, 'pady': 6}

        header = ttk.Frame(self)
        header.pack(fill='x', padx=12, pady=(10, 2))
        ttk.Label(header, text='📥  Download Manager', style='Header.TLabel').pack(anchor='w')
        ttk.Label(header, text='Add URLs to the queue, then start, pause or resume downloads.',
                  style='Sub.TLabel').pack(anchor='w')

        # URL input
        url_panel = ttk.LabelFrame(self, text='Add URLs (one per line)')
        url_panel.pack(fill='x', **pad)

        text_wrap = ttk.Frame(url_panel)
        text_wrap.pack(fill='x', padx=8, pady=(8, 4))
        self.url_text = tk.Text(text_wrap, height=4, wrap='none', undo=True,
                                font=FONT_MONO, relief='flat', borderwidth=1,
                                highlightthickness=1, highlightbackground=BORDER,
                                highlightcolor=ACCENT)
        url_vscroll = ttk.Scrollbar(text_wrap, command=self.url_text.yview)
        self.url_text.configure(yscrollcommand=url_vscroll.set)
        self.url_text.pack(side='left', fill='both', expand=True)
        url_vscroll.pack(side='right', fill='y')

        url_btns = ttk.Frame(url_panel)
        url_btns.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Button(url_btns, text='➕ Add to queue', style='Accent.TButton', command=self._add_to_queue).pack(side='left')
        ttk.Button(url_btns, text='📋 Paste', command=self._paste_clipboard).pack(side='left', padx=6)
        ttk.Button(url_btns, text='📄 Load links_to_download.txt', command=self._load_links_file).pack(side='left')
        ttk.Button(url_btns, text='✖ Clear box', command=lambda: self.url_text.delete('1.0', 'end')).pack(side='left', padx=6)

        # Destination
        out_panel = ttk.LabelFrame(self, text='Destination')
        out_panel.pack(fill='x', **pad)
        out_inner = ttk.Frame(out_panel)
        out_inner.pack(fill='x', padx=8, pady=8)
        ttk.Label(out_inner, text='Save to:').pack(side='left')
        ttk.Entry(out_inner, textvariable=self.out_dir).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(out_inner, text='Browse…', command=self._browse).pack(side='left')
        ttk.Button(out_inner, text='Open', command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left', padx=(6, 0))

        # Controls
        ctrl = ttk.Frame(self)
        ctrl.pack(fill='x', **pad)
        self.start_btn = ttk.Button(ctrl, text='▶  Start', style='Accent.TButton', command=self._start)
        self.start_btn.pack(side='left')
        self.stop_btn = ttk.Button(ctrl, text='■  Stop', style='Stop.TButton', command=self._stop, state='disabled')
        self.stop_btn.pack(side='left', padx=6)
        ttk.Button(ctrl, text='↻ Retry selected', command=self._retry_selected).pack(side='left')
        ttk.Button(ctrl, text='🗑 Remove selected', command=self._remove_selected).pack(side='left', padx=6)
        ttk.Button(ctrl, text='🧹 Clear finished', command=self._clear_finished).pack(side='left')
        ttk.Label(ctrl, textvariable=self.overall_var, style='Count.TLabel').pack(side='right')

        # Queue list
        list_panel = ttk.LabelFrame(self, text='Queue')
        list_panel.pack(fill='both', expand=True, **pad)
        list_inner = ttk.Frame(list_panel)
        list_inner.pack(fill='both', expand=True, padx=8, pady=8)

        self.tree = ttk.Treeview(list_inner, columns=('status', 'progress'),
                                 show='tree headings', selectmode='extended')
        self.tree.heading('#0', text='URL / File')
        self.tree.heading('status', text='Status')
        self.tree.heading('progress', text='Progress')
        self.tree.column('#0', width=520, stretch=True)
        self.tree.column('status', width=130, anchor='w', stretch=False)
        self.tree.column('progress', width=90, anchor='e', stretch=False)
        tree_scroll = ttk.Scrollbar(list_inner, command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.pack(side='left', fill='both', expand=True)
        tree_scroll.pack(side='right', fill='y')
        self.tree.bind('<Double-1>', self._open_selected_file)

        self.tree.tag_configure(ST_DONE, foreground=SUCCESS)
        self.tree.tag_configure(ST_ERROR, foreground=ERROR)
        self.tree.tag_configure(ST_DOWNLOADING, foreground=ACCENT)
        self.tree.tag_configure(ST_STOPPED, foreground=MUTED)

        # Status bar
        status = ttk.Frame(self)
        status.pack(fill='x', padx=12, pady=(0, 10))
        ttk.Label(status, textvariable=self.status_var, style='Status.TLabel', anchor='w').pack(side='left', fill='x', expand=True)

    # ── queue management ─────────────────────────────────────────────
    def _paste_clipboard(self):
        try:
            text = self.clipboard_get()
        except tk.TclError:
            return
        if text.strip():
            self.url_text.insert('end', text.strip() + '\n')

    def _load_links_file(self):
        urls = [u for u in _read_link_lines(LINKS_TO_DOWNLOAD) if u.startswith(('http://', 'https://'))]
        if not urls:
            messagebox.showinfo('No links', f'{LINKS_TO_DOWNLOAD.name} is empty or has no http(s) URLs.')
            return
        self.url_text.insert('end', '\n'.join(urls) + '\n')

    def _add_to_queue(self):
        raw = self.url_text.get('1.0', 'end').splitlines()
        existing = {it['url'] for it in self.items.values()}
        added_urls = []
        for line in raw:
            url = line.strip()
            if not url.startswith(('http://', 'https://')) or url in existing:
                continue
            existing.add(url)
            self._add_item(url)
            added_urls.append(url)
        if added_urls:
            # Persist newly pasted links to the top of links_to_download.txt.
            _prepend_links(LINKS_TO_DOWNLOAD, added_urls)
            self.url_text.delete('1.0', 'end')
            self.status_var.set(f'Added {len(added_urls)} URL{"s" if len(added_urls) != 1 else ""} to the queue.')
        else:
            messagebox.showinfo('Nothing added', 'No new http(s) URLs found in the box.')
        self._update_overall()
        # If a run is in progress, the worker will pick up the new items.

    def _add_item(self, url):
        iid = f'item{next(self._ids)}'
        self.items[iid] = {'url': url, 'status': ST_QUEUED, 'pct': 0, 'file': None, 'title': None}
        self.tree.insert('', 'end', iid=iid, text=url,
                         values=(STATUS_LABEL[ST_QUEUED], ''))
        return iid

    def _set_item(self, iid, **changes):
        item = self.items.get(iid)
        if not item:
            return
        item.update(changes)
        label = item.get('title') or item['url']
        if item['status'] == ST_DONE and item['file']:
            label = os.path.basename(item['file'])
        pct = item['pct']
        pct_text = f'{pct:.0f}%' if item['status'] == ST_DOWNLOADING and pct else (
            '100%' if item['status'] == ST_DONE else '')
        tag = item['status'] if item['status'] in (ST_DONE, ST_ERROR, ST_DOWNLOADING, ST_STOPPED) else ''
        self.tree.item(iid, text=label, values=(STATUS_LABEL[item['status']], pct_text),
                       tags=(tag,) if tag else ())

    def _next_queued(self):
        for iid in self.tree.get_children():
            if self.items[iid]['status'] in (ST_QUEUED, ST_STOPPED):
                return iid
        return None

    def _update_overall(self):
        total = len(self.items)
        done = sum(1 for it in self.items.values() if it['status'] == ST_DONE)
        err = sum(1 for it in self.items.values() if it['status'] == ST_ERROR)
        self.overall_var.set(f'{done}/{total} done' + (f' · {err} failed' if err else '') if total else '')

    def _remove_selected(self):
        for iid in self.tree.selection():
            if self.items.get(iid, {}).get('status') == ST_DOWNLOADING:
                messagebox.showwarning('In progress', 'Stop the queue before removing the active download.')
                return
        for iid in self.tree.selection():
            self.items.pop(iid, None)
            self.tree.delete(iid)
        self._update_overall()

    def _retry_selected(self):
        for iid in self.tree.selection():
            item = self.items.get(iid)
            if item and item['status'] in (ST_ERROR, ST_DONE, ST_STOPPED):
                self._set_item(iid, status=ST_QUEUED, pct=0)
        self._update_overall()
        if self.is_running:
            return
        if self._next_queued():
            self.status_var.set('Items re-queued. Press Start to download.')

    def _clear_finished(self):
        for iid in list(self.tree.get_children()):
            if self.items[iid]['status'] == ST_DONE:
                self.items.pop(iid, None)
                self.tree.delete(iid)
        self._update_overall()

    # ── run control ──────────────────────────────────────────────────
    def _start(self):
        if self.is_running:
            return
        if not SCRIPT_PATH.exists():
            messagebox.showerror('Not found', f'Could not find {SCRIPT_PATH}')
            return
        if not self._next_queued():
            messagebox.showinfo('Empty queue', 'Add some URLs to the queue first.')
            return
        out_dir = Path(self.out_dir.get())
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            messagebox.showerror('Invalid folder', str(e))
            return

        self.is_running = True
        self._stop_requested = False
        self.start_btn.configure(state='disabled')
        self.stop_btn.configure(state='normal')
        self.status_var.set('Downloading…')
        threading.Thread(target=self._worker, args=(out_dir,), daemon=True).start()

    def _stop(self):
        self._stop_requested = True
        self.stop_btn.configure(state='disabled')
        self.status_var.set('Stopping after the current item…')
        if self.current_proc and self.current_proc.poll() is None:
            try:
                self.current_proc.terminate()
            except OSError:
                pass

    def _worker(self, out_dir):
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        env['APHRO_DOWNLOADS_DIR'] = str(out_dir)

        while self.is_running and not self._stop_requested:
            iid = self._next_queued()
            if not iid:
                break
            item = self.items[iid]
            self.out_queue.put(('status', iid, ST_DOWNLOADING, None))
            code, result_file, title = self._download_item(item['url'], out_dir, iid, env)

            if self._stop_requested:
                # Re-queue (as stopped) so resume continues from the .part file.
                self.out_queue.put(('status', iid, ST_STOPPED, None))
                break
            if code == 0 and result_file:
                self.out_queue.put(('status', iid, ST_DONE, result_file))
                self.out_queue.put(('mark', item['url'], None, None))
            else:
                self.out_queue.put(('status', iid, ST_ERROR, None))

        self.out_queue.put(('finished', None, None, None))

    def _download_item(self, url, out_dir, iid, env):
        cmd = [_python_bin(), '-u', str(SCRIPT_PATH), '--url', url, '--out-dir', str(out_dir)]
        try:
            self.current_proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace',
                env=env, cwd=str(PROJECT_ROOT),
            )
        except OSError as e:
            self.out_queue.put(('log', None, f'[error] failed to launch: {e}', None))
            self.current_proc = None
            return -1, None, None

        result_file, title = None, None
        for line in _read_stream(self.current_proc.stdout):
            line = line.strip()
            if not line:
                continue
            m = PROGRESS_RE.search(line)
            if m:
                self.out_queue.put(('progress', iid, float(m.group(1)), None))
                continue
            mt = TITLE_RE.search(line)
            if mt:
                title = mt.group(1)
                self.out_queue.put(('title', iid, title, None))
            elif line.startswith('RESULT_FILE:'):
                result_file = line.split(':', 1)[1].strip()
            self.out_queue.put(('log', iid, line, None))

        code = self.current_proc.wait()
        self.current_proc = None
        return code, result_file, title

    # ── UI message pump ──────────────────────────────────────────────
    def _poll_queue(self):
        try:
            while True:
                kind, iid, a, b = self.out_queue.get_nowait()
                if kind == 'status':
                    if a == ST_DONE:
                        self._set_item(iid, status=ST_DONE, file=b, pct=100)
                    else:
                        self._set_item(iid, status=a)
                    self._update_overall()
                elif kind == 'progress':
                    self._set_item(iid, status=ST_DOWNLOADING, pct=a)
                elif kind == 'title':
                    self._set_item(iid, title=a)
                elif kind == 'mark':
                    self._mark_downloaded(a)  # a holds the url here
                elif kind == 'log':
                    self.status_var.set(a)
                elif kind == 'finished':
                    self._on_finished()
        except queue.Empty:
            pass
        self.after(100, self._poll_queue)

    def _on_finished(self):
        self.is_running = False
        self.start_btn.configure(state='normal')
        self.stop_btn.configure(state='disabled')
        if self._stop_requested:
            self.status_var.set('⏸ Stopped. Press Start to resume.')
        elif self._next_queued():
            self.status_var.set('Paused — items remain in the queue.')
        else:
            self.status_var.set('✅ All downloads finished.')
        self._stop_requested = False

    def _mark_downloaded(self, url):
        _remove_link(LINKS_TO_DOWNLOAD, url)
        _append_link(LINKS_DOWNLOADED, url)

    # ── misc actions ─────────────────────────────────────────────────
    def _browse(self):
        d = filedialog.askdirectory(initialdir=self.out_dir.get() or str(PROJECT_ROOT))
        if d:
            self.out_dir.set(d)

    def _open_path(self, path):
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        if sys.platform == 'win32':
            os.startfile(str(path))
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', str(path)])
        else:
            subprocess.Popen(['xdg-open', str(path)])

    def _open_selected_file(self, event=None):
        sel = self.tree.selection()
        if not sel:
            return
        item = self.items.get(sel[0])
        if item and item.get('file') and os.path.exists(item['file']):
            self._open_path(Path(item['file']).parent)

    def _on_close(self):
        self._stop_requested = True
        if self.current_proc and self.current_proc.poll() is None:
            try:
                self.current_proc.terminate()
            except OSError:
                pass
        self.destroy()


if __name__ == '__main__':
    DownloadManager().mainloop()
