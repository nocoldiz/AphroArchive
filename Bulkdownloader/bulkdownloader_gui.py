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

PROGRESS_RE = re.compile(r'^\[(\d+)/(\d+)]\s*Processing:\s*(.*)$')
VIDEO_EXTS = ('mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'flv', 'wmv', 'ts', '3gp')

# Folders that don't make sense as sort destinations.
SKIP_DIRS = {'hidden', 'Z', 'downloads', '.thumbs'}


def _python_bin():
    """Interpreter used to run bulkdownloader.py."""
    if not FROZEN:
        return sys.executable
    for name in ('python', 'python3'):
        found = shutil.which(name)
        if found:
            return found
    return 'python'


class BulkDownloaderGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('AphroArchive — Bulk Video Downloader')
        self.geometry('900x680')
        self.minsize(700, 480)

        self.proc = None
        self.out_queue = queue.Queue()
        self.out_dir = tk.StringVar(value=str(DEFAULT_OUT_DIR))
        self.status_var = tk.StringVar(value='Idle')
        self.new_folder_var = tk.StringVar()

        self._build_ui()
        self.after(100, self._poll_queue)
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ── UI layout ─────────────────────────────────────────────────────
    def _build_ui(self):
        notebook = ttk.Notebook(self)
        notebook.pack(fill='both', expand=True)

        download_tab = ttk.Frame(notebook)
        sort_tab = ttk.Frame(notebook)
        notebook.add(download_tab, text='Download')
        notebook.add(sort_tab, text='Sort downloads')
        notebook.bind('<<NotebookTabChanged>>', lambda e: self._refresh_sort_lists()
                      if notebook.index('current') == 1 else None)

        self._build_download_tab(download_tab)
        self._build_sort_tab(sort_tab)

    def _build_download_tab(self, root):
        pad = {'padx': 8, 'pady': 6}

        top = ttk.Frame(root)
        top.pack(fill='x', **pad)
        ttk.Label(top, text='URLs (one per line):').pack(anchor='w')

        self.url_text = tk.Text(top, height=8, wrap='none', undo=True)
        self.url_text.pack(fill='x', expand=True, pady=(2, 6))

        url_btns = ttk.Frame(top)
        url_btns.pack(fill='x')
        ttk.Button(url_btns, text='Paste from clipboard', command=self._paste_clipboard).pack(side='left')
        ttk.Button(url_btns, text='Clear URLs', command=lambda: self.url_text.delete('1.0', 'end')).pack(side='left', padx=6)

        # Output folder row
        out_frame = ttk.Frame(root)
        out_frame.pack(fill='x', **pad)
        ttk.Label(out_frame, text='Save to:').pack(side='left')
        ttk.Entry(out_frame, textvariable=self.out_dir).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(out_frame, text='Browse…', command=self._browse).pack(side='left')
        ttk.Button(out_frame, text='Open folder', command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left', padx=(6, 0))

        # Controls
        ctrl_frame = ttk.Frame(root)
        ctrl_frame.pack(fill='x', **pad)
        self.start_btn = ttk.Button(ctrl_frame, text='Start download', command=self._start)
        self.start_btn.pack(side='left')
        self.stop_btn = ttk.Button(ctrl_frame, text='Stop', command=self._stop, state='disabled')
        self.stop_btn.pack(side='left', padx=6)
        ttk.Button(ctrl_frame, text='Clear log', command=self._clear_log).pack(side='left')

        self.progress = ttk.Progressbar(ctrl_frame, mode='determinate')
        self.progress.pack(side='left', fill='x', expand=True, padx=12)

        # Log
        log_frame = ttk.Frame(root)
        log_frame.pack(fill='both', expand=True, **pad)
        ttk.Label(log_frame, text='Log:').pack(anchor='w')

        text_frame = ttk.Frame(log_frame)
        text_frame.pack(fill='both', expand=True)
        self.log_text = tk.Text(text_frame, state='disabled', wrap='word', bg='#1e1e1e', fg='#d4d4d4',
                                 insertbackground='#d4d4d4', font=('Consolas', 9))
        scrollbar = ttk.Scrollbar(text_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side='left', fill='both', expand=True)
        scrollbar.pack(side='right', fill='y')

        # Status bar
        status = ttk.Frame(root)
        status.pack(fill='x', padx=8, pady=(0, 6))
        ttk.Label(status, textvariable=self.status_var, anchor='w').pack(side='left', fill='x', expand=True)

    def _build_sort_tab(self, root):
        pad = {'padx': 8, 'pady': 6}

        ttk.Label(root, text='Move downloaded files into a category folder under videos/').pack(anchor='w', **pad)

        lists_frame = ttk.Frame(root)
        lists_frame.pack(fill='both', expand=True, padx=8)

        # Left: downloaded files
        left = ttk.LabelFrame(lists_frame, text='Downloaded files')
        left.pack(side='left', fill='both', expand=True, padx=(0, 4), pady=4)
        self.files_list = tk.Listbox(left, selectmode='extended')
        files_scroll = ttk.Scrollbar(left, command=self.files_list.yview)
        self.files_list.configure(yscrollcommand=files_scroll.set)
        self.files_list.pack(side='left', fill='both', expand=True)
        files_scroll.pack(side='right', fill='y')

        # Right: destination folders
        right = ttk.LabelFrame(lists_frame, text='Destination folder (videos/...)')
        right.pack(side='left', fill='both', expand=True, padx=(4, 0), pady=4)
        self.folders_list = tk.Listbox(right, exportselection=False)
        folders_scroll = ttk.Scrollbar(right, command=self.folders_list.yview)
        self.folders_list.configure(yscrollcommand=folders_scroll.set)
        self.folders_list.pack(side='left', fill='both', expand=True)
        folders_scroll.pack(side='right', fill='y')

        # New folder row
        new_folder_frame = ttk.Frame(root)
        new_folder_frame.pack(fill='x', **pad)
        ttk.Label(new_folder_frame, text='New folder name:').pack(side='left')
        ttk.Entry(new_folder_frame, textvariable=self.new_folder_var).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(new_folder_frame, text='Create', command=self._create_folder).pack(side='left')

        # Actions
        actions = ttk.Frame(root)
        actions.pack(fill='x', **pad)
        ttk.Button(actions, text='Refresh', command=self._refresh_sort_lists).pack(side='left')
        ttk.Button(actions, text='Move selected →', command=self._move_selected).pack(side='left', padx=6)
        ttk.Button(actions, text='Open downloads folder', command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left')
        ttk.Button(actions, text='Open videos folder', command=lambda: self._open_path(VIDEOS_ROOT)).pack(side='left', padx=6)

        self.sort_status_var = tk.StringVar(value='')
        ttk.Label(root, textvariable=self.sort_status_var, anchor='w').pack(fill='x', padx=8, pady=(0, 6))

    # ── download actions ─────────────────────────────────────────────
    def _paste_clipboard(self):
        try:
            text = self.clipboard_get()
        except tk.TclError:
            return
        if text.strip():
            self.url_text.insert('end', text.strip() + '\n')

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

        self._clear_log()
        self.progress.configure(mode='determinate', maximum=len(urls), value=0)
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
        self._log(line)
        m = PROGRESS_RE.match(line)
        if m:
            done, total = int(m.group(1)), int(m.group(2))
            self.progress.configure(maximum=total, value=done - 1)
            self.status_var.set(f'[{done}/{total}] {m.group(3)}')

    def _on_finished(self, code):
        self.start_btn.configure(state='normal')
        self.stop_btn.configure(state='disabled')
        self.progress.configure(value=self.progress['maximum'])
        if code == 0:
            self.status_var.set('All downloads completed.')
        elif code == -1:
            self.status_var.set('Failed to start.')
        else:
            self.status_var.set(f'Finished (exit code {code}).')
        self.proc = None

    def _clear_log(self):
        self.log_text.configure(state='normal')
        self.log_text.delete('1.0', 'end')
        self.log_text.configure(state='disabled')

    def _log(self, text):
        self.log_text.configure(state='normal')
        self.log_text.insert('end', text + '\n')
        self.log_text.see('end')
        self.log_text.configure(state='disabled')

    # ── sort actions ──────────────────────────────────────────────────
    def _refresh_sort_lists(self):
        out_dir = Path(self.out_dir.get())
        self.files_list.delete(0, 'end')
        if out_dir.is_dir():
            for f in sorted(out_dir.iterdir()):
                if f.is_file() and f.suffix.lstrip('.').lower() in VIDEO_EXTS:
                    self.files_list.insert('end', f.name)

        self.folders_list.delete(0, 'end')
        if VIDEOS_ROOT.is_dir():
            for d in sorted(VIDEOS_ROOT.iterdir()):
                if d.is_dir() and d.name not in SKIP_DIRS and not d.name.startswith('.'):
                    self.folders_list.insert('end', d.name)

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
        self._refresh_sort_lists()
        names = self.folders_list.get(0, 'end')
        if safe in names:
            self.folders_list.selection_clear(0, 'end')
            self.folders_list.selection_set(names.index(safe))
            self.folders_list.see(names.index(safe))

    def _move_selected(self):
        file_idxs = self.files_list.curselection()
        folder_idx = self.folders_list.curselection()
        if not file_idxs:
            messagebox.showwarning('Nothing selected', 'Select one or more files to move.')
            return
        if not folder_idx:
            messagebox.showwarning('No destination', 'Select a destination folder (or create one).')
            return

        out_dir = Path(self.out_dir.get())
        dest_dir = VIDEOS_ROOT / self.folders_list.get(folder_idx[0])
        dest_dir.mkdir(parents=True, exist_ok=True)

        moved, skipped = 0, 0
        for idx in file_idxs:
            name = self.files_list.get(idx)
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

        self.sort_status_var.set(f'Moved {moved} file(s) to {dest_dir.name}/' +
                                  (f' — {skipped} skipped (already exist)' if skipped else ''))
        self._refresh_sort_lists()

    def _on_close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.destroy()


if __name__ == '__main__':
    BulkDownloaderGUI().mainloop()
