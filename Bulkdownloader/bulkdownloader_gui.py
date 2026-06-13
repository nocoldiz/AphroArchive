#!/usr/bin/env python3
"""GUI front-end for bulkdownloader.py.

Lets you paste a list of video page URLs, pick (or accept the default)
output folder, watch progress/log output, and afterwards sort the
downloaded files into category folders under videos/ — all without
touching a terminal.

Already-downloaded files in the output folder are skipped automatically
by bulkdownloader.py itself.
"""

import os
import re
import sys
import shutil
import queue
import threading
import subprocess
import webbrowser
import tkinter as tk
from pathlib import Path
from tkinter import ttk, filedialog, messagebox

import site_search

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

WEBSITES_FILE = APP_DIR / 'websites.json'
APHROARCHIVE_WEBSITES_JSON = PROJECT_ROOT / 'db' / 'websites.json'

PROGRESS_RE = re.compile(r'^\[(\d+)/(\d+)]\s*Processing:\s*(.*)$')
VIDEO_EXTS = ('mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'flv', 'wmv', 'ts', '3gp')

# Folders that don't make sense as sort destinations.
SKIP_DIRS = {'hidden', 'Z', 'downloads', '.thumbs'}

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

FONT = ('Segoe UI', 10)
FONT_BOLD = ('Segoe UI', 10, 'bold')
FONT_HEADER = ('Segoe UI', 15, 'bold')
FONT_SUB = ('Segoe UI', 9)
FONT_MONO = ('Consolas', 9)


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
    """Create the link-tracking text files next to this script if missing."""
    for path in (LINKS_TO_DOWNLOAD, LINKS_DOWNLOADED):
        if not path.exists():
            path.touch()


def _ensure_websites_file():
    """Create websites.json next to this script, seeding from AphroArchive's
    own database export if available, so the registry isn't empty on first run."""
    if WEBSITES_FILE.exists():
        return
    sites = site_search.load_websites(APHROARCHIVE_WEBSITES_JSON)
    site_search.save_websites(WEBSITES_FILE, sites)


def _read_link_lines(path):
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]


def _write_link_lines(path, lines):
    text = '\n'.join(lines)
    path.write_text(text + '\n' if lines else '', encoding='utf-8')


def _remove_link(path, url):
    lines = _read_link_lines(path)
    if url in lines:
        _write_link_lines(path, [u for u in lines if u != url])


def _append_link(path, url):
    lines = _read_link_lines(path)
    if url not in lines:
        lines.append(url)
        _write_link_lines(path, lines)


def _human_size(num_bytes):
    size = float(num_bytes)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if size < 1024 or unit == 'TB':
            return f'{size:.0f} {unit}' if unit == 'B' else f'{size:.1f} {unit}'
        size /= 1024


class BulkDownloaderGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('AphroArchive — Bulk Video Downloader')
        self.geometry('1000x720')
        self.minsize(760, 540)
        self.configure(bg=BG)

        _ensure_link_files()
        _ensure_websites_file()

        self.proc = None
        self.out_queue = queue.Queue()
        self.out_dir = tk.StringVar(value=str(DEFAULT_OUT_DIR))
        self.status_var = tk.StringVar(value='Idle')
        self.new_folder_var = tk.StringVar()
        self.folder_filter_var = tk.StringVar()
        self.url_count_var = tk.StringVar(value='0 URLs')
        self.progress_pct_var = tk.StringVar(value='0%')

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
        style.configure('TNotebook', background=BG, borderwidth=0)
        style.configure('TNotebook.Tab', font=FONT_BOLD, padding=(16, 8))

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

        style.configure('Treeview', font=FONT, rowheight=24, background=PANEL_BG,
                        fieldbackground=PANEL_BG, bordercolor=BORDER)
        style.configure('Treeview.Heading', font=FONT_BOLD, padding=(6, 4))
        style.map('Treeview', background=[('selected', ACCENT)], foreground=[('selected', 'white')])

    # ── UI layout ─────────────────────────────────────────────────────
    def _build_ui(self):
        header = ttk.Frame(self)
        header.pack(fill='x', padx=12, pady=(10, 4))
        ttk.Label(header, text='📥  Bulk Video Downloader', style='Header.TLabel').pack(anchor='w')
        ttk.Label(header, text='Paste page URLs, download them, then sort into your video library.',
                  style='Sub.TLabel').pack(anchor='w')

        notebook = ttk.Notebook(self)
        notebook.pack(fill='both', expand=True, padx=12, pady=(6, 10))

        download_tab = ttk.Frame(notebook)
        sort_tab = ttk.Frame(notebook)
        notebook.add(download_tab, text='⬇  Download')
        notebook.add(sort_tab, text='🗂  Sort downloads')
        self.notebook = notebook
        notebook.bind('<<NotebookTabChanged>>', lambda e: self._refresh_sort_lists()
                      if notebook.index('current') == 1 else None)

        self._build_download_tab(download_tab)
        self._build_sort_tab(sort_tab)

    def _build_download_tab(self, root):
        pad = {'padx': 10, 'pady': 6}

        # URLs panel
        url_panel = ttk.LabelFrame(root, text='URLs to download')
        url_panel.pack(fill='x', **pad)

        text_wrap = ttk.Frame(url_panel)
        text_wrap.pack(fill='x', padx=8, pady=(8, 4))
        self.url_text = tk.Text(text_wrap, height=8, wrap='none', undo=True,
                                 font=FONT_MONO, relief='flat', borderwidth=1,
                                 highlightthickness=1, highlightbackground=BORDER,
                                 highlightcolor=ACCENT)
        url_vscroll = ttk.Scrollbar(text_wrap, command=self.url_text.yview)
        self.url_text.configure(yscrollcommand=url_vscroll.set)
        self.url_text.pack(side='left', fill='both', expand=True)
        url_vscroll.pack(side='right', fill='y')
        self.url_text.bind('<<Modified>>', self._on_url_text_changed)

        url_btns = ttk.Frame(url_panel)
        url_btns.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Button(url_btns, text='📋 Paste from clipboard', command=self._paste_clipboard).pack(side='left')
        ttk.Button(url_btns, text='📄 Load from links_to_download.txt', command=self._load_links_file).pack(side='left', padx=6)
        ttk.Button(url_btns, text='🧹 Clean & dedupe', command=self._clean_urls).pack(side='left', padx=6)
        ttk.Button(url_btns, text='✖ Clear', command=self._clear_urls).pack(side='left')
        ttk.Label(url_btns, textvariable=self.url_count_var, style='Count.TLabel').pack(side='right')

        # Output folder row
        out_panel = ttk.LabelFrame(root, text='Destination')
        out_panel.pack(fill='x', **pad)
        out_inner = ttk.Frame(out_panel)
        out_inner.pack(fill='x', padx=8, pady=8)
        ttk.Label(out_inner, text='Save to:').pack(side='left')
        ttk.Entry(out_inner, textvariable=self.out_dir).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(out_inner, text='Browse…', command=self._browse).pack(side='left')
        ttk.Button(out_inner, text='Open folder', command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left', padx=(6, 0))

        # Controls
        ctrl_frame = ttk.Frame(root)
        ctrl_frame.pack(fill='x', **pad)
        self.start_btn = ttk.Button(ctrl_frame, text='▶  Start download', style='Accent.TButton', command=self._start)
        self.start_btn.pack(side='left')
        self.stop_btn = ttk.Button(ctrl_frame, text='■  Stop', style='Stop.TButton', command=self._stop, state='disabled')
        self.stop_btn.pack(side='left', padx=6)
        ttk.Button(ctrl_frame, text='Clear log', command=self._clear_log).pack(side='left')

        progress_frame = ttk.Frame(ctrl_frame)
        progress_frame.pack(side='left', fill='x', expand=True, padx=12)
        self.progress = ttk.Progressbar(progress_frame, mode='determinate')
        self.progress.pack(side='left', fill='x', expand=True)
        ttk.Label(progress_frame, textvariable=self.progress_pct_var, width=5, anchor='e').pack(side='left', padx=(8, 0))

        # Log
        log_frame = ttk.LabelFrame(root, text='Log')
        log_frame.pack(fill='both', expand=True, **pad)

        text_frame = ttk.Frame(log_frame)
        text_frame.pack(fill='both', expand=True, padx=8, pady=8)
        self.log_text = tk.Text(text_frame, state='disabled', wrap='word', bg=LOG_BG, fg=LOG_FG,
                                 insertbackground=LOG_FG, font=FONT_MONO, relief='flat',
                                 padx=8, pady=6)
        scrollbar = ttk.Scrollbar(text_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side='left', fill='both', expand=True)
        scrollbar.pack(side='right', fill='y')

        self.log_text.tag_configure('error', foreground='#f87171')
        self.log_text.tag_configure('success', foreground='#4ade80')
        self.log_text.tag_configure('progress', foreground='#60a5fa')

        # Status bar
        status = ttk.Frame(self)
        status.pack(fill='x', padx=12, pady=(0, 10))
        ttk.Label(status, textvariable=self.status_var, style='Status.TLabel', anchor='w').pack(side='left', fill='x', expand=True)
        self.status_bar = status

    def _build_sort_tab(self, root):
        pad = {'padx': 10, 'pady': 6}

        ttk.Label(root, text='Move downloaded files into a category folder under videos/',
                  style='Sub.TLabel').pack(anchor='w', **pad)

        lists_frame = ttk.Frame(root)
        lists_frame.pack(fill='both', expand=True, padx=10)
        lists_frame.columnconfigure(0, weight=1)
        lists_frame.columnconfigure(1, weight=1)
        lists_frame.rowconfigure(0, weight=1)

        # Left: downloaded files
        left = ttk.LabelFrame(lists_frame, text='Downloaded files')
        left.grid(row=0, column=0, sticky='nsew', padx=(0, 4), pady=4)

        left_inner = ttk.Frame(left)
        left_inner.pack(fill='both', expand=True, padx=6, pady=6)
        self.files_list = ttk.Treeview(left_inner, columns=('size',), show='headings', selectmode='extended')
        self.files_list.heading('#0', text='File')
        self.files_list.heading('size', text='Size')
        self.files_list.column('size', width=80, anchor='e', stretch=False)
        self.files_list['displaycolumns'] = ('size',)
        # Use the tree column (#0) for the filename so it's easy to read.
        self.files_list['show'] = 'tree headings'
        self.files_list.column('#0', width=260, stretch=True)
        files_scroll = ttk.Scrollbar(left_inner, command=self.files_list.yview)
        self.files_list.configure(yscrollcommand=files_scroll.set)
        self.files_list.pack(side='left', fill='both', expand=True)
        files_scroll.pack(side='right', fill='y')

        left_btns = ttk.Frame(left)
        left_btns.pack(fill='x', padx=6, pady=(0, 6))
        ttk.Button(left_btns, text='Select all', command=self._select_all_files).pack(side='left')
        ttk.Button(left_btns, text='Clear selection', command=lambda: self.files_list.selection_remove(*self.files_list.selection())).pack(side='left', padx=6)
        self.files_count_var = tk.StringVar(value='')
        ttk.Label(left_btns, textvariable=self.files_count_var, style='Count.TLabel').pack(side='right')

        # Right: destination folders
        right = ttk.LabelFrame(lists_frame, text='Destination folder (videos/...)')
        right.grid(row=0, column=1, sticky='nsew', padx=(4, 0), pady=4)

        filter_frame = ttk.Frame(right)
        filter_frame.pack(fill='x', padx=6, pady=(6, 0))
        ttk.Label(filter_frame, text='🔎').pack(side='left')
        filter_entry = ttk.Entry(filter_frame, textvariable=self.folder_filter_var)
        filter_entry.pack(side='left', fill='x', expand=True, padx=(4, 0))
        self.folder_filter_var.trace_add('write', lambda *a: self._populate_folders())

        right_inner = ttk.Frame(right)
        right_inner.pack(fill='both', expand=True, padx=6, pady=6)
        self.folders_list = ttk.Treeview(right_inner, show='tree', selectmode='browse')
        self.folders_list.column('#0', stretch=True)
        folders_scroll = ttk.Scrollbar(right_inner, command=self.folders_list.yview)
        self.folders_list.configure(yscrollcommand=folders_scroll.set)
        self.folders_list.pack(side='left', fill='both', expand=True)
        folders_scroll.pack(side='right', fill='y')

        # New folder row
        new_folder_frame = ttk.Frame(root)
        new_folder_frame.pack(fill='x', **pad)
        ttk.Label(new_folder_frame, text='New folder:').pack(side='left')
        new_folder_entry = ttk.Entry(new_folder_frame, textvariable=self.new_folder_var)
        new_folder_entry.pack(side='left', fill='x', expand=True, padx=6)
        new_folder_entry.bind('<Return>', lambda e: self._create_folder())
        ttk.Button(new_folder_frame, text='➕ Create', command=self._create_folder).pack(side='left')

        # Actions
        actions = ttk.Frame(root)
        actions.pack(fill='x', **pad)
        ttk.Button(actions, text='🔄 Refresh', command=self._refresh_sort_lists).pack(side='left')
        ttk.Button(actions, text='➜  Move selected', style='Accent.TButton', command=self._move_selected).pack(side='left', padx=6)
        ttk.Button(actions, text='Open downloads folder', command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left')
        ttk.Button(actions, text='Open videos folder', command=lambda: self._open_path(VIDEOS_ROOT)).pack(side='left', padx=6)

        self.sort_status_var = tk.StringVar(value='')
        ttk.Label(root, textvariable=self.sort_status_var, style='Status.TLabel', anchor='w').pack(fill='x', padx=10, pady=(0, 6))

    # ── download actions ─────────────────────────────────────────────
    def _on_url_text_changed(self, event=None):
        # <<Modified>> fires repeatedly unless the flag is reset.
        self.url_text.edit_modified(False)
        n = len(self._get_urls())
        self.url_count_var.set(f'{n} URL{"s" if n != 1 else ""}')

    def _paste_clipboard(self):
        try:
            text = self.clipboard_get()
        except tk.TclError:
            return
        if text.strip():
            self.url_text.insert('end', text.strip() + '\n')
            self._on_url_text_changed()

    def _clean_urls(self):
        """Strip blank lines, trim whitespace, and remove duplicate URLs."""
        seen = set()
        cleaned = []
        for line in self.url_text.get('1.0', 'end').splitlines():
            u = line.strip()
            if u and u not in seen:
                seen.add(u)
                cleaned.append(u)
        self.url_text.delete('1.0', 'end')
        if cleaned:
            self.url_text.insert('1.0', '\n'.join(cleaned) + '\n')
        self._on_url_text_changed()

    def _load_links_file(self):
        urls = [u for u in _read_link_lines(LINKS_TO_DOWNLOAD) if u.startswith(('http://', 'https://'))]
        if not urls:
            messagebox.showinfo('No links', f'{LINKS_TO_DOWNLOAD.name} is empty or has no http(s) URLs.')
            return
        existing = set(self._get_urls())
        new = [u for u in urls if u not in existing]
        if new:
            current = self.url_text.get('1.0', 'end').strip()
            if current:
                self.url_text.insert('end', '\n' + '\n'.join(new) + '\n')
            else:
                self.url_text.insert('1.0', '\n'.join(new) + '\n')
        self._on_url_text_changed()

    def _clear_urls(self):
        self.url_text.delete('1.0', 'end')
        self._on_url_text_changed()

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

    def _get_urls(self):
        lines = self.url_text.get('1.0', 'end').splitlines()
        return [u.strip() for u in lines if u.strip().startswith(('http://', 'https://'))]

    def _start(self):
        if not SCRIPT_PATH.exists():
            messagebox.showerror('Not found', f'Could not find {SCRIPT_PATH}')
            return
        urls = self._get_urls()
        if not urls:
            messagebox.showwarning('No URLs', 'Paste at least one http(s) URL, one per line.')
            return

        out_dir = Path(self.out_dir.get())
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            messagebox.showerror('Invalid folder', str(e))
            return

        self._run_urls = urls
        self._marked_count = 0

        self._clear_log()
        self.progress.configure(mode='determinate', maximum=len(urls), value=0)
        self.progress_pct_var.set('0%')
        self.status_var.set(f'Starting download of {len(urls)} item(s)…')
        self.start_btn.configure(state='disabled')
        self.stop_btn.configure(state='normal')

        threading.Thread(target=self._run_subprocess, args=(urls, out_dir), daemon=True).start()

    def _stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self.out_queue.put(('line', '[stopped by user]'))

    def _run_subprocess(self, urls, out_dir):
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        env['APHRO_DOWNLOADS_DIR'] = str(out_dir)

        try:
            self.proc = subprocess.Popen(
                [_python_bin(), '-u', str(SCRIPT_PATH)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace',
                env=env, cwd=str(PROJECT_ROOT),
            )
        except OSError as e:
            self.out_queue.put(('line', f'[error] failed to launch: {e}'))
            self.out_queue.put(('done', -1))
            return

        try:
            self.proc.stdin.write('\n'.join(urls) + '\ndone\n')
            self.proc.stdin.close()
        except (OSError, ValueError):
            pass

        for raw_line in self.proc.stdout:
            self.out_queue.put(('line', raw_line.rstrip()))

        code = self.proc.wait()
        self.out_queue.put(('done', code))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.out_queue.get_nowait()
                if kind == 'line':
                    self._handle_line(payload)
                elif kind == 'done':
                    self._on_finished(payload)
        except queue.Empty:
            pass
        self.after(100, self._poll_queue)

    def _handle_line(self, line):
        if not line:
            return
        m = PROGRESS_RE.match(line)
        if m:
            self._log(line, tag='progress')
            done, total = int(m.group(1)), int(m.group(2))
            self.progress.configure(maximum=total, value=done - 1)
            pct = int((done - 1) / total * 100) if total else 0
            self.progress_pct_var.set(f'{pct}%')
            self.status_var.set(f'[{done}/{total}] {m.group(3)}')
            while self._marked_count < done - 1:
                self._mark_downloaded(self._run_urls[self._marked_count])
                self._marked_count += 1
        elif line.lower().startswith(('[error]', 'error')):
            self._log(line, tag='error')
        else:
            self._log(line)

    def _on_finished(self, code):
        self.start_btn.configure(state='normal')
        self.stop_btn.configure(state='disabled')
        self.progress.configure(value=self.progress['maximum'])
        total = self.progress['maximum'] or 1
        self.progress_pct_var.set('100%' if code == 0 else self.progress_pct_var.get())
        if code == 0:
            self.progress_pct_var.set('100%')
            self.status_var.set('✅ All downloads completed.')
            self._log('All downloads completed.', tag='success')
            while self._marked_count < len(self._run_urls):
                self._mark_downloaded(self._run_urls[self._marked_count])
                self._marked_count += 1
        elif code == -1:
            self.status_var.set('❌ Failed to start.')
        else:
            self.status_var.set(f'⏹ Finished (exit code {code}).')
        self.proc = None

    def _mark_downloaded(self, url):
        _remove_link(LINKS_TO_DOWNLOAD, url)
        _append_link(LINKS_DOWNLOADED, url)

    def _clear_log(self):
        self.log_text.configure(state='normal')
        self.log_text.delete('1.0', 'end')
        self.log_text.configure(state='disabled')

    def _log(self, text, tag=None):
        self.log_text.configure(state='normal')
        self.log_text.insert('end', text + '\n', tag if tag else ())
        self.log_text.see('end')
        self.log_text.configure(state='disabled')

    # ── sort actions ──────────────────────────────────────────────────
    def _select_all_files(self):
        self.files_list.selection_set(self.files_list.get_children())

    def _refresh_sort_lists(self):
        out_dir = Path(self.out_dir.get())
        self.files_list.delete(*self.files_list.get_children())
        count = 0
        if out_dir.is_dir():
            for f in sorted(out_dir.iterdir()):
                if f.is_file() and f.suffix.lstrip('.').lower() in VIDEO_EXTS:
                    try:
                        size = f.stat().st_size
                    except OSError:
                        size = 0
                    self.files_list.insert('', 'end', iid=f.name, text=f.name, values=(_human_size(size),))
                    count += 1
        self.files_count_var.set(f'{count} file{"s" if count != 1 else ""}')
        self.notebook.tab(1, text=f'🗂  Sort downloads ({count})' if count else '🗂  Sort downloads')

        self._populate_folders()

    def _populate_folders(self):
        self.folders_list.delete(*self.folders_list.get_children())
        if not VIDEOS_ROOT.is_dir():
            return
        needle = self.folder_filter_var.get().strip().lower()
        for d in sorted(VIDEOS_ROOT.iterdir()):
            if d.is_dir() and d.name not in SKIP_DIRS and not d.name.startswith('.'):
                if needle and needle not in d.name.lower():
                    continue
                self.folders_list.insert('', 'end', iid=d.name, text='📁 ' + d.name)

    def _create_folder(self):
        name = self.new_folder_var.get().strip()
        if not name:
            return
        safe = re.sub(r'[<>:"/\\|?*]', '_', name)
        target = VIDEOS_ROOT / safe
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            messagebox.showerror('Could not create folder', str(e))
            return
        self.new_folder_var.set('')
        self.folder_filter_var.set('')
        self._refresh_sort_lists()
        if self.folders_list.exists(safe):
            self.folders_list.selection_set(safe)
            self.folders_list.see(safe)

    def _move_selected(self):
        file_names = self.files_list.selection()
        folder_sel = self.folders_list.selection()
        if not file_names:
            messagebox.showwarning('Nothing selected', 'Select one or more files to move.')
            return
        if not folder_sel:
            messagebox.showwarning('No destination', 'Select a destination folder (or create one).')
            return

        out_dir = Path(self.out_dir.get())
        dest_name = folder_sel[0]
        dest_dir = VIDEOS_ROOT / dest_name
        dest_dir.mkdir(parents=True, exist_ok=True)

        moved, skipped = 0, 0
        for name in file_names:
            src = out_dir / name
            dest = dest_dir / name
            if dest.exists():
                skipped += 1
                continue
            try:
                shutil.move(str(src), str(dest))
                moved += 1
            except OSError as e:
                self.sort_status_var.set(f'Error moving {name}: {e}')
                continue

        msg = f'✅ Moved {moved} file(s) to {dest_name}/'
        if skipped:
            msg += f' — {skipped} skipped (already exist)'
        self.sort_status_var.set(msg)
        self._refresh_sort_lists()

    def _on_close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.destroy()


if __name__ == '__main__':
    BulkDownloaderGUI().mainloop()
