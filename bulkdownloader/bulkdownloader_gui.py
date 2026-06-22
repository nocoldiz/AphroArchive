#!/usr/bin/env python3
"""Tabbed GUI download manager for bulkdownloader.py.

Five tabs:

* **Downloads** — a download queue backed by ``links_to_download.txt``.
  The queue auto-loads from the txt files on launch (queued / done / failed),
  preserves the file order, can be paused/resumed and drag-reordered, runs
  several downloads in parallel (configurable), and every change is written
  straight back to the txt files so the order survives a restart. Each URL is
  downloaded by its own ``bulkdownloader.py --url …`` subprocess, so a paused
  item resumes from its partial ``.part`` file on the next run. Rows have
  tick-box selection; Delete removes the ticked/selected rows.
* **Bookmarks** — temporarily reads Firefox + Chromium (Chrome/Edge/Brave)
  bookmarks and shows only the ones whose host matches a site in
  ``websites.json``; filter by typing, tick rows, then push them to the top or
  bottom of the download queue.
* **Search** — open any site's ``searchURL`` for a query in the browser, star
  sites as favourites (persisted to ``websites.json``) and open every
  favourite's search in its own browser tab with one button.
* **Gallery** — a thumbnail grid of every video already in the download
  folder; double-click to play in the system player.
* **X.com** — log in for sensitive / login-gated X.com videos: use your
  browser's live login (recommended), paste ``auth_token`` / ``ct0`` tokens
  (with a step-by-step guide), or import / paste a ``cookies.txt``.

The window size, download folder, parallel count and last tab are remembered
between runs. Files land in the chosen output folder — no categorization here.
"""

import os
import re
import sys
import json
import time
import shutil
import queue
import hashlib
import sqlite3
import tempfile
import threading
import itertools
import subprocess
import webbrowser
import urllib.parse
import tkinter as tk
from pathlib import Path
from tkinter import ttk, filedialog, messagebox

# ── path resolution (works both as a plain script and as a frozen exe) ──

FROZEN = getattr(sys, 'frozen', False)
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
BUNDLE_DIR = Path(getattr(sys, '_MEIPASS', APP_DIR))

if FROZEN:
    # bulkdownloader.py is bundled as data alongside the frozen exe.
    SCRIPT_PATH = BUNDLE_DIR / 'bulkdownloader.py'
else:
    SCRIPT_PATH = APP_DIR / 'bulkdownloader.py'


def _find_project_root():
    for base in (APP_DIR, APP_DIR.parent, APP_DIR.parent.parent):
        if (base / 'server').is_dir() or (base / 'videos').is_dir():
            return base
    return APP_DIR.parent if APP_DIR.parent.exists() else APP_DIR


def _user_data_dir():
    """Per-OS writable folder for user data — used when frozen, so a packaged
    .app/.exe never writes inside its own (possibly read-only / signed) bundle."""
    home = Path.home()
    if sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', home / 'AppData' / 'Roaming'))
    elif sys.platform == 'darwin':
        base = home / 'Library' / 'Application Support'
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config'))
    return base / 'AphroArchive' / 'bulkdownloader'


PROJECT_ROOT = _find_project_root()
VIDEOS_ROOT = PROJECT_ROOT / 'videos'
DEFAULT_OUT_DIR = VIDEOS_ROOT / 'downloads'

# In dev (running the script) keep everything in the repo folder so it works
# with bulkdownloader.py's own links files. When frozen, use the per-OS dir.
DATA_DIR = APP_DIR if not FROZEN else _user_data_dir()
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    DATA_DIR = APP_DIR

LINKS_TO_DOWNLOAD = DATA_DIR / 'links_to_download.txt'
LINKS_DOWNLOADED = DATA_DIR / 'links_downloaded.txt'
LINKS_FAILED = DATA_DIR / 'link_failed.txt'
CONFIG_FILE = DATA_DIR / 'gui_config.json'

# Website registry — the same shape AphroArchive exports via
# GET /api/db/websites/export. Kept in DATA_DIR so favourites persist.
WEBSITES_JSON = DATA_DIR / 'websites.json'

# Netscape-format cookies for login-gated sites (X.com sensitive/age-gated tweets).
COOKIES_FILE = DATA_DIR / 'cookies.txt'

# Cache dir for the gallery's ffmpeg-generated thumbnails.
THUMB_CACHE_DIR = Path(tempfile.gettempdir()) / 'aphro_gallery_thumbs'

VIDEO_EXTS = {'.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.flv', '.ts', '.wmv', '.mpg', '.mpeg', '.m2ts'}
GALLERY_MAX = 240          # cap files shown so a huge folder doesn't stall the UI
DONE_LOAD_CAP = 60         # only show the most recent N completed rows on launch
DOWNLOADED_FILE_CAP = 2000  # trim links_downloaded.txt to this many lines
THUMB_W, THUMB_H = 240, 135
CARD_W = 264

# Browsers yt-dlp can read live cookies from (the "proper login" path).
BROWSER_CHOICES = ['chrome', 'firefox', 'edge', 'brave', 'chromium', 'opera', 'vivaldi']
if sys.platform == 'darwin':
    BROWSER_CHOICES.append('safari')

# Per-item subprocess output: "   [download]  45.3% of 120.4MiB at 5.2MiB/s ETA 00:12"
PROGRESS_RE = re.compile(r'\[download\]\s+([\d.]+)%')
SPEED_RE = re.compile(r'\bat\s+([\d.]+\s*[KMG]?i?B/s)', re.I)
ETA_RE = re.compile(r'\bETA\s+([\d:]+)')
TITLE_RE = re.compile(r'\[title\]\s+"(.+)"')

# Query params that are pure tracking noise — stripped only for de-dup keys,
# never from the URL we actually download.
TRACKING_PARAMS = {'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                   'fbclid', 'gclid', 'ref', 'ref_', 'igshid', 'si', 'feature'}

# ── palette ──────────────────────────────────────────────────────────
BG = '#f3f4f6'
PANEL_BG = '#ffffff'
ACCENT = '#2563eb'
ACCENT_ACTIVE = '#1d4ed8'
SUCCESS = '#16a34a'
ERROR = '#dc2626'
MUTED = '#6b7280'
BORDER = '#d1d5db'
GOLD = '#d97706'
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

PENDING_STATUSES = (ST_QUEUED, ST_STOPPED, ST_DOWNLOADING)
RESUMABLE_STATUSES = (ST_QUEUED, ST_STOPPED)

CHK_ON, CHK_OFF = '☑', '☐'


def _python_bin():
    """Interpreter used to run bulkdownloader.py."""
    if not FROZEN:
        return sys.executable
    for name in ('python', 'python3'):
        found = shutil.which(name)
        if found:
            return found
    return 'python'


def _subprocess_flags():
    """Keep child consoles from flashing on Windows when run from a windowed exe."""
    if sys.platform == 'win32':
        return {'creationflags': 0x08000000}  # CREATE_NO_WINDOW
    return {}


def _ensure_link_files():
    for path in (LINKS_TO_DOWNLOAD, LINKS_DOWNLOADED, LINKS_FAILED):
        if not path.exists():
            try:
                path.touch()
            except OSError:
                pass


def _seed_websites_json():
    """Copy the bundled websites.json into DATA_DIR once (frozen builds) so the
    user can edit it and persist favourites."""
    if WEBSITES_JSON.exists():
        return
    for src in (BUNDLE_DIR / 'websites.json', APP_DIR / 'websites.json'):
        if src.exists() and src.resolve() != WEBSITES_JSON.resolve():
            try:
                shutil.copyfile(src, WEBSITES_JSON)
            except OSError:
                pass
            return


def _read_link_lines(path):
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]


def _write_link_lines(path, lines):
    try:
        path.write_text('\n'.join(lines) + '\n' if lines else '', encoding='utf-8')
    except OSError:
        pass


def _remove_link(path, url):
    lines = _read_link_lines(path)
    if url in lines:
        _write_link_lines(path, [u for u in lines if u != url])


def _append_link(path, url, cap=None):
    lines = _read_link_lines(path)
    if url not in lines:
        lines.append(url)
        if cap and len(lines) > cap:
            lines = lines[-cap:]
        _write_link_lines(path, lines)


def _is_http(url):
    return url.startswith(('http://', 'https://'))


def _norm_key(url):
    """De-dup key: lowercase host, drop tracking params + trailing slash/fragment.
    Used ONLY for duplicate detection — the original URL is what gets downloaded."""
    try:
        p = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return url.strip().lower()
    host = (p.hostname or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    query = urllib.parse.urlencode([
        (k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
        if k.lower() not in TRACKING_PARAMS
    ])
    return urllib.parse.urlunsplit((p.scheme.lower(), host, p.path.rstrip('/'), query, ''))


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


# ── config persistence ────────────────────────────────────────────────

def _load_config():
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


# ── website registry (raw JSON, so favourites + all fields round-trip) ──

def _load_websites_raw():
    for path in (WEBSITES_JSON, APP_DIR / 'websites.json', BUNDLE_DIR / 'websites.json'):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(data, list):
                return [s for s in data if isinstance(s, dict)]
        except (OSError, ValueError):
            continue
    return []


def _save_websites_raw(sites):
    try:
        WEBSITES_JSON.write_text(json.dumps(sites, indent=2, ensure_ascii=False), encoding='utf-8')
        return True
    except OSError:
        return False


def _host_of(url):
    try:
        host = (urllib.parse.urlparse(url).hostname or '').lower()
    except ValueError:
        host = ''
    return host[4:] if host.startswith('www.') else host


def _build_site_matchers(sites):
    """For each site, collect candidate hosts + a name token for loose matching."""
    matchers = []
    for s in sites:
        hosts = set()
        for key in ('url', 'searchURL'):
            h = _host_of(s.get(key) or '')
            if h:
                hosts.add(h)
        token = re.sub(r'[^a-z0-9]', '', (s.get('name') or '').lower())
        matchers.append((s.get('name') or (next(iter(hosts), '')), hosts, token))
    return matchers


def _match_host(host, matchers):
    """Return the matching site name for a bookmark host, or None.

    A bookmark matches when its host equals/is a sub-domain of a registered
    host, or when a whole domain label equals the site's name token (also
    catching numbered mirrors like ``xvideos2``). Substring matching is
    deliberately avoided so a site literally named ``porn`` doesn't swallow
    every host that happens to contain the word.
    """
    host = host.lower()
    if host.startswith('www.'):
        host = host[4:]
    labels = host.split('.')
    for name, hosts, token in matchers:
        for h in hosts:
            if h and (host == h or host.endswith('.' + h) or h.endswith('.' + host)):
                return name
        if token and len(token) >= 4:
            for lab in labels:
                if lab == token or (lab.startswith(token) and lab[len(token):].isdigit()):
                    return name
    return None


# ── browser bookmark readers ─────────────────────────────────────────

def _chromium_bookmark_files():
    """List (label, Bookmarks-json-path) for every Chromium profile found."""
    home = Path.home()
    if sys.platform == 'win32':
        local = Path(os.environ.get('LOCALAPPDATA', home / 'AppData' / 'Local'))
        roots = {
            'Chrome': local / 'Google' / 'Chrome' / 'User Data',
            'Edge': local / 'Microsoft' / 'Edge' / 'User Data',
            'Brave': local / 'BraveSoftware' / 'Brave-Browser' / 'User Data',
        }
    elif sys.platform == 'darwin':
        app = home / 'Library' / 'Application Support'
        roots = {
            'Chrome': app / 'Google' / 'Chrome',
            'Edge': app / 'Microsoft Edge',
            'Brave': app / 'BraveSoftware' / 'Brave-Browser',
        }
    else:
        cfg = home / '.config'
        roots = {
            'Chrome': cfg / 'google-chrome',
            'Chromium': cfg / 'chromium',
            'Edge': cfg / 'microsoft-edge',
            'Brave': cfg / 'BraveSoftware' / 'Brave-Browser',
        }
    found = []
    for browser, root in roots.items():
        if not root.is_dir():
            continue
        try:
            profiles = sorted(root.iterdir())
        except OSError:
            continue
        for prof in profiles:
            bm = prof / 'Bookmarks'
            if bm.is_file():
                found.append((f'{browser} · {prof.name}', bm))
    return found


def _read_chromium_bookmarks(path):
    out = []
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8', errors='replace'))
    except (OSError, ValueError):
        return out

    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get('type') == 'url':
            url = node.get('url') or ''
            if _is_http(url):
                out.append((node.get('name') or url, url))
        for child in node.get('children') or []:
            walk(child)

    for key in ('bookmark_bar', 'other', 'synced'):
        node = (data.get('roots') or {}).get(key)
        if node:
            walk(node)
    return out


def _firefox_places_files():
    home = Path.home()
    if sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', home / 'AppData' / 'Roaming')) / 'Mozilla' / 'Firefox' / 'Profiles'
    elif sys.platform == 'darwin':
        base = home / 'Library' / 'Application Support' / 'Firefox' / 'Profiles'
    else:
        base = home / '.mozilla' / 'firefox'
    if not base.is_dir():
        return []
    return [(p.name, p / 'places.sqlite') for p in sorted(base.iterdir())
            if p.is_dir() and (p / 'places.sqlite').is_file()]


def _read_firefox_bookmarks(places_path):
    """Read bookmarks from a copy of places.sqlite (the live file is locked while
    Firefox is open). The -wal / -shm sidecars are copied too so the newest
    bookmarks aren't missed."""
    out = []
    tmpdir = Path(tempfile.mkdtemp(prefix='aphro_ff_'))
    try:
        dst = tmpdir / 'places.sqlite'
        shutil.copyfile(places_path, dst)
        for ext in ('-wal', '-shm'):
            side = Path(str(places_path) + ext)
            if side.exists():
                try:
                    shutil.copyfile(side, Path(str(dst) + ext))
                except OSError:
                    pass
        try:
            con = sqlite3.connect(f'file:{dst}?mode=ro', uri=True)
        except sqlite3.Error:
            con = sqlite3.connect(str(dst))
        try:
            cur = con.execute(
                'SELECT b.title, p.url FROM moz_bookmarks b '
                'JOIN moz_places p ON b.fk = p.id '
                "WHERE b.type = 1 AND p.url LIKE 'http%'")
            for title, url in cur.fetchall():
                if url:
                    out.append((title or url, url))
        finally:
            con.close()
    except (OSError, sqlite3.Error):
        pass
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return out


# ── X.com cookie helpers ─────────────────────────────────────────────

def _cookie_status(config):
    """Human label describing the active X.com login method."""
    browser = (config or {}).get('cookies_from_browser', '')
    if browser:
        return (f'✓ Using your {browser.title()} browser login — yt-dlp reads its live '
                f'cookies. Stay signed in to x.com in {browser.title()}.')
    if not COOKIES_FILE.exists():
        return '○ No X.com login configured — sensitive / login-gated videos may fail.'
    try:
        head = COOKIES_FILE.read_text(encoding='utf-8', errors='replace')[:65536]
    except OSError:
        return '○ cookies.txt present but unreadable.'
    if 'x.com' in head or 'twitter.com' in head:
        return '✓ X.com login cookies saved — used automatically for downloads.'
    return '⚠ cookies.txt present but contains no x.com/twitter cookies.'


def _write_x_cookies_from_tokens(auth_token, ct0):
    """Synthesize a Netscape cookies.txt from the two cookies that matter for X.com."""
    expiry = int(time.time()) + 365 * 24 * 3600
    lines = ['# Netscape HTTP Cookie File',
             '# Generated by AphroArchive Download Manager', '']
    for domain in ('.x.com', '.twitter.com'):
        lines.append(f'{domain}\tTRUE\t/\tTRUE\t{expiry}\tauth_token\t{auth_token}')
        if ct0:
            lines.append(f'{domain}\tTRUE\t/\tTRUE\t{expiry}\tct0\t{ct0}')
    COOKIES_FILE.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def _autodetect_cookies():
    """Scan common folders for an exported cookies.txt with x.com cookies."""
    home = Path.home()
    dirs = [DATA_DIR, APP_DIR, Path.cwd(), home, home / 'Downloads', home / 'Desktop', home / 'Documents']
    best = None
    for d in dirs:
        if not d.is_dir():
            continue
        try:
            candidates = list(d.glob('*.txt'))
        except OSError:
            continue
        for p in candidates:
            try:
                if p.resolve() == COOKIES_FILE.resolve():
                    continue
                head = p.read_text(encoding='utf-8', errors='replace')[:65536]
            except OSError:
                continue
            if ('x.com' in head or 'twitter.com' in head) and ('\t' in head or 'Netscape' in head):
                try:
                    mtime = p.stat().st_mtime
                except OSError:
                    mtime = 0
                if best is None or mtime > best[0]:
                    best = (mtime, p)
    return best[1] if best else None


# ════════════════════════════════════════════════════════════════════
#  Main window
# ════════════════════════════════════════════════════════════════════

class DownloadManager(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('AphroArchive — Download Manager')
        self.minsize(860, 580)
        self.configure(bg=BG)

        _ensure_link_files()
        _seed_websites_json()
        self._config = _load_config()

        self._ids = itertools.count(1)
        self.items = {}                  # iid -> {url, status, pct, file, title, speed, eta, error}
        self.out_queue = queue.Queue()   # worker/threads -> UI messages

        # ── parallel download engine state (all mutated on the main thread) ──
        self.active = {}                 # iid -> Popen (or None until launched)
        self._cancelling = set()         # iids intentionally terminated (pause / cancel)
        self._timeouts = set()           # iids killed by the stall watchdog
        self._activity = {}              # iid -> monotonic ts of last output (watchdog)
        self.is_running = False
        self.paused = False
        self._env = None
        self._out_dir_path = None
        self._drag_iid = None

        self.sites_raw = _load_websites_raw()
        self._all_bookmarks = []

        self._gallery_gen = 0
        self._gallery_cards = []
        self._gallery_thumb_labels = []
        self._gallery_imgs = []
        self._gallery_cols = 0

        self.out_dir = tk.StringVar(value=self._config.get('out_dir') or str(DEFAULT_OUT_DIR))
        self.max_parallel = tk.IntVar(value=int(self._config.get('max_parallel', 2) or 2))
        self.start_timeout = tk.IntVar(value=int(self._config.get('start_timeout', 90) or 0))
        self.autostart_var = tk.BooleanVar(value=bool(self._config.get('autostart', True)))
        self.status_var = tk.StringVar(value='Idle')
        self.overall_var = tk.StringVar(value='')

        self._setup_style()
        self._build_ui()
        self._load_initial_queue()

        # Restore geometry / tab, then start auto-saving on changes.
        geo = self._config.get('geometry')
        try:
            self.geometry(geo if geo else '1060x740')
        except tk.TclError:
            self.geometry('1060x740')
        try:
            self.nb.select(int(self._config.get('last_tab', 0)))
        except (tk.TclError, ValueError):
            pass
        self.out_dir.trace_add('write', lambda *_: self._save_config())
        self.max_parallel.trace_add('write', lambda *_: self._save_config())

        self.after(100, self._poll_queue)
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ── styling ───────────────────────────────────────────────────────
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
        style.configure('Guide.TLabel', font=FONT_SUB, background=PANEL_BG, foreground='#374151')
        style.configure('Status.TLabel', font=FONT, background=BG, foreground='#374151')
        style.configure('Count.TLabel', font=FONT_SUB, background=BG, foreground=MUTED)
        style.configure('Card.TFrame', background=PANEL_BG, relief='solid', borderwidth=1)
        style.configure('CardName.TLabel', background=PANEL_BG, font=FONT_SUB, foreground='#374151')
        style.configure('CardSub.TLabel', background=PANEL_BG, font=(_UI_FONT, 8), foreground=MUTED)

        style.configure('TEntry', padding=4)
        style.configure('TProgressbar', thickness=14, background=ACCENT)

        style.configure('Treeview', font=FONT, rowheight=26, background=PANEL_BG,
                        fieldbackground=PANEL_BG, bordercolor=BORDER)
        style.configure('Treeview.Heading', font=FONT_BOLD, padding=(6, 4))
        style.map('Treeview', background=[('selected', '#dbeafe')], foreground=[('selected', '#111827')])

        style.configure('TNotebook', background=BG, borderwidth=0)
        style.configure('TNotebook.Tab', font=FONT_BOLD, padding=(16, 8))
        style.map('TNotebook.Tab',
                  background=[('selected', PANEL_BG)],
                  foreground=[('selected', ACCENT), ('!selected', MUTED)])

    # ── overall layout ────────────────────────────────────────────────
    def _build_ui(self):
        body = ttk.Frame(self)
        body.pack(fill='both', expand=True, padx=8, pady=(8, 4))

        self._build_console_drawer(body)   # right-hand drawer (created hidden)

        self.nb = ttk.Notebook(body)
        self.nb.pack(side='left', fill='both', expand=True)

        self.tab_downloads = ttk.Frame(self.nb)
        self.tab_bookmarks = ttk.Frame(self.nb)
        self.tab_search = ttk.Frame(self.nb)
        self.tab_gallery = ttk.Frame(self.nb)
        self.tab_xlogin = ttk.Frame(self.nb)

        self.nb.add(self.tab_downloads, text='⬇ Downloads')
        self.nb.add(self.tab_bookmarks, text='🔖 Bookmarks')
        self.nb.add(self.tab_search, text='🔍 Search')
        self.nb.add(self.tab_gallery, text='🎬 Gallery')
        self.nb.add(self.tab_xlogin, text='🔑 X.com')

        self._build_downloads_tab(self.tab_downloads)
        self._build_bookmarks_tab(self.tab_bookmarks)
        self._build_search_tab(self.tab_search)
        self._build_gallery_tab(self.tab_gallery)
        self._build_xlogin_tab(self.tab_xlogin)

        self.nb.bind('<<NotebookTabChanged>>', self._on_tab_changed)

        status = ttk.Frame(self)
        status.pack(fill='x', padx=12, pady=(0, 8))
        ttk.Label(status, textvariable=self.status_var, style='Status.TLabel',
                  anchor='w').pack(side='left', fill='x', expand=True)
        self.console_btn = ttk.Button(status, text='🖥 Console ▸', command=self._toggle_console)
        self.console_btn.pack(side='right')

    # ── reusable tick-box behaviour for any Treeview (column name 'chk') ──
    def _setup_checktree(self, tree):
        tree._checked = set()
        tree.heading('chk', text=CHK_OFF, command=lambda t=tree: self._toggle_all_checks(t))
        tree.bind('<Button-1>', lambda e, t=tree: self._on_chk_click(e, t), add='+')
        tree.bind('<space>', lambda e, t=tree: self._space_toggle(t))

    def _on_chk_click(self, event, tree):
        if tree.identify_region(event.x, event.y) != 'cell':
            return None
        if tree.identify_column(event.x) != '#1':   # the leading tick-box column
            return None
        iid = tree.identify_row(event.y)
        if iid:
            self._set_check(tree, iid, iid not in tree._checked)
            return 'break'
        return None

    def _set_check(self, tree, iid, on):
        if on:
            tree._checked.add(iid)
        else:
            tree._checked.discard(iid)
        try:
            tree.set(iid, 'chk', CHK_ON if on else CHK_OFF)
        except tk.TclError:
            pass

    def _toggle_all_checks(self, tree):
        kids = tree.get_children()
        turn_on = not (kids and all(i in tree._checked for i in kids))
        for i in kids:
            self._set_check(tree, i, turn_on)

    def _space_toggle(self, tree):
        for iid in tree.selection():
            self._set_check(tree, iid, iid not in tree._checked)
        return 'break'

    def _targets(self, tree, fallback_all=False):
        """Ticked rows, else the normal selection, else (optionally) every row."""
        checked = [i for i in tree.get_children() if i in getattr(tree, '_checked', ())]
        if checked:
            return checked
        sel = list(tree.selection())
        if sel:
            return sel
        return list(tree.get_children()) if fallback_all else []

    # ════════════════════════════════════════════════════════════════
    #  Downloads tab
    # ════════════════════════════════════════════════════════════════
    def _build_downloads_tab(self, parent):
        pad = {'padx': 12, 'pady': 6}

        url_panel = ttk.LabelFrame(parent, text='Add URLs (one per line)')
        url_panel.pack(fill='x', **pad)

        text_wrap = ttk.Frame(url_panel)
        text_wrap.pack(fill='x', padx=8, pady=(8, 4))
        self.url_text = tk.Text(text_wrap, height=3, wrap='none', undo=True,
                                font=FONT_MONO, relief='flat', borderwidth=1,
                                highlightthickness=1, highlightbackground=BORDER,
                                highlightcolor=ACCENT)
        url_vscroll = ttk.Scrollbar(text_wrap, command=self.url_text.yview)
        self.url_text.configure(yscrollcommand=url_vscroll.set)
        self.url_text.pack(side='left', fill='both', expand=True)
        url_vscroll.pack(side='right', fill='y')
        self.url_text.bind('<Control-Return>', lambda e: (self._download_now(), 'break')[1])

        url_btns = ttk.Frame(url_panel)
        url_btns.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Button(url_btns, text='⚡ Download now', style='Accent.TButton',
                   command=self._download_now).pack(side='left')
        ttk.Button(url_btns, text='➕ Add to bottom',
                   command=lambda: self._add_box_to_queue(at_top=False)).pack(side='left', padx=6)
        ttk.Button(url_btns, text='⤴ Add to top',
                   command=lambda: self._add_box_to_queue(at_top=True)).pack(side='left')
        ttk.Button(url_btns, text='📋 Paste', command=self._paste_clipboard).pack(side='left', padx=6)
        ttk.Button(url_btns, text='✖ Clear box',
                   command=lambda: self.url_text.delete('1.0', 'end')).pack(side='left')
        ttk.Button(url_btns, text='🔄 Reload from files', command=self._reload_from_files).pack(side='right')

        out_panel = ttk.LabelFrame(parent, text='Destination')
        out_panel.pack(fill='x', **pad)
        out_inner = ttk.Frame(out_panel)
        out_inner.pack(fill='x', padx=8, pady=8)
        ttk.Label(out_inner, text='Save to:').pack(side='left')
        ttk.Entry(out_inner, textvariable=self.out_dir).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(out_inner, text='Browse…', command=self._browse).pack(side='left')
        ttk.Button(out_inner, text='Open',
                   command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left', padx=(6, 0))

        ctrl = ttk.Frame(parent)
        ctrl.pack(fill='x', **pad)
        self.start_btn = ttk.Button(ctrl, text='▶  Start', style='Accent.TButton', command=self._start)
        self.start_btn.pack(side='left')
        self.pause_btn = ttk.Button(ctrl, text='⏸  Pause', style='Stop.TButton',
                                    command=self._pause, state='disabled')
        self.pause_btn.pack(side='left', padx=6)
        ttk.Label(ctrl, text='Parallel:').pack(side='left', padx=(6, 2))
        ttk.Spinbox(ctrl, from_=1, to=10, width=4, textvariable=self.max_parallel,
                    command=self._pump).pack(side='left')
        ttk.Label(ctrl, text='Stall timeout (s):').pack(side='left', padx=(8, 2))
        ttk.Spinbox(ctrl, from_=0, to=600, increment=10, width=5, textvariable=self.start_timeout,
                    command=self._save_config).pack(side='left')
        ttk.Checkbutton(ctrl, text='Auto-start', variable=self.autostart_var,
                        command=self._save_config).pack(side='left', padx=(8, 0))
        ttk.Button(ctrl, text='↻ Retry', command=self._retry_selected).pack(side='left', padx=(10, 0))
        ttk.Button(ctrl, text='🗑 Remove', command=self._remove_selected).pack(side='left', padx=6)
        ttk.Button(ctrl, text='🧹 Clear finished', command=self._clear_finished).pack(side='left')
        ttk.Label(ctrl, textvariable=self.overall_var, style='Count.TLabel').pack(side='right')

        list_panel = ttk.LabelFrame(parent, text='Queue  ·  tick rows, drag to reorder, Delete removes')
        list_panel.pack(fill='both', expand=True, **pad)
        list_inner = ttk.Frame(list_panel)
        list_inner.pack(fill='both', expand=True, padx=8, pady=8)

        self.tree = ttk.Treeview(list_inner, columns=('chk', 'status', 'progress', 'speed'),
                                 show='tree headings', selectmode='extended')
        self.tree.heading('#0', text='URL / File')
        self.tree.heading('status', text='Status')
        self.tree.heading('progress', text='%')
        self.tree.heading('speed', text='Speed / ETA')
        self.tree.column('#0', width=480, stretch=True)
        self.tree.column('chk', width=34, anchor='center', stretch=False)
        self.tree.column('status', width=120, anchor='w', stretch=False)
        self.tree.column('progress', width=56, anchor='e', stretch=False)
        self.tree.column('speed', width=150, anchor='w', stretch=False)
        tree_scroll = ttk.Scrollbar(list_inner, command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.pack(side='left', fill='both', expand=True)
        tree_scroll.pack(side='right', fill='y')
        self._setup_checktree(self.tree)
        self.tree.bind('<Double-1>', self._open_selected_file)
        self.tree.bind('<ButtonPress-1>', self._on_tree_press, add='+')
        self.tree.bind('<B1-Motion>', self._on_tree_motion)
        self.tree.bind('<ButtonRelease-1>', self._on_tree_release)
        self.tree.bind('<Delete>', lambda e: self._remove_selected())
        self.tree.bind('<KP_Delete>', lambda e: self._remove_selected())
        self.tree.bind('<BackSpace>', lambda e: self._remove_selected())
        self.tree.bind('<Button-3>', self._popup_menu)
        self.tree.bind('<Button-2>', self._popup_menu)

        self.tree.tag_configure(ST_DONE, foreground=SUCCESS)
        self.tree.tag_configure(ST_ERROR, foreground=ERROR)
        self.tree.tag_configure(ST_DOWNLOADING, foreground=ACCENT)
        self.tree.tag_configure(ST_STOPPED, foreground=MUTED)

        self.ctx_menu = tk.Menu(self, tearoff=0)
        self.ctx_menu.add_command(label='⚡ Download now', command=self._download_now_rows)
        self.ctx_menu.add_separator()
        self.ctx_menu.add_command(label='Move to top', command=lambda: self._move_targets(0))
        self.ctx_menu.add_command(label='Move to bottom', command=lambda: self._move_targets('end'))
        self.ctx_menu.add_separator()
        self.ctx_menu.add_command(label='Retry', command=self._retry_selected)
        self.ctx_menu.add_command(label='Remove', command=self._remove_selected)
        self.ctx_menu.add_separator()
        self.ctx_menu.add_command(label='Open file / folder', command=self._open_selected_file)

    # ── queue file <-> tree sync ──────────────────────────────────────
    def _load_initial_queue(self):
        """Populate the tree from the txt files on launch, preserving order.
        Done rows are capped so a long history doesn't bloat the queue."""
        seen = set()

        def add_all(path, status, limit=None):
            urls = [u for u in _read_link_lines(path) if _is_http(u)]
            if limit:
                urls = urls[-limit:]
            for url in urls:
                k = _norm_key(url)
                if k not in seen:
                    seen.add(k)
                    self._add_item(url, status=status)
            return len(urls)

        add_all(LINKS_TO_DOWNLOAD, ST_QUEUED)
        add_all(LINKS_FAILED, ST_ERROR)
        total_done = len([u for u in _read_link_lines(LINKS_DOWNLOADED) if _is_http(u)])
        add_all(LINKS_DOWNLOADED, ST_DONE, limit=DONE_LOAD_CAP)

        self._update_overall()
        if self._next_pending():
            extra = f' ({total_done - DONE_LOAD_CAP} older done rows hidden)' if total_done > DONE_LOAD_CAP else ''
            self.status_var.set(f'Queue loaded from files. Press Start to download.{extra}')

    def _rebuild_to_download_file(self):
        urls = []
        for iid in self.tree.get_children():
            it = self.items.get(iid)
            if it and it['status'] in PENDING_STATUSES:
                urls.append(it['url'])
        _write_link_lines(LINKS_TO_DOWNLOAD, list(dict.fromkeys(urls)))

    # ── queue management ──────────────────────────────────────────────
    def _paste_clipboard(self):
        try:
            text = self.clipboard_get()
        except tk.TclError:
            return
        if text.strip():
            self.url_text.insert('end', text.strip() + '\n')

    def _reload_from_files(self):
        if self.is_running:
            messagebox.showinfo('Running', 'Pause downloads before reloading the queue from files.')
            return
        for iid in list(self.tree.get_children()):
            self.tree.delete(iid)
        self.items.clear()
        self.tree._checked.clear()
        self._load_initial_queue()
        self.status_var.set('Queue reloaded from txt files.')

    def _add_box_to_queue(self, at_top=False):
        raw = self.url_text.get('1.0', 'end').splitlines()
        added = self._queue_urls([l.strip() for l in raw], at_top=at_top)
        if added:
            self.url_text.delete('1.0', 'end')
            where = 'top' if at_top else 'bottom'
            self.status_var.set(f'Added {added} URL{"s" if added != 1 else ""} to the {where} of the queue.')
            self._pump()
        else:
            messagebox.showinfo('Nothing added', 'No new http(s) URLs found in the box.')

    def _queue_urls(self, urls, at_top=False):
        existing = {_norm_key(it['url']) for it in self.items.values()}
        new = []
        for u in urls:
            if not _is_http(u):
                continue
            k = _norm_key(u)
            if k in existing:
                continue
            existing.add(k)
            new.append(u)
        for i, u in enumerate(new):
            self._add_item(u, index=(i if at_top else 'end'))
        if new:
            self._rebuild_to_download_file()
            self._update_overall()
        return len(new)

    def _add_item(self, url, status=ST_QUEUED, index='end'):
        iid = f'item{next(self._ids)}'
        self.items[iid] = {'url': url, 'status': status, 'pct': 100 if status == ST_DONE else 0,
                           'file': None, 'title': None, 'speed': '', 'eta': '', 'error': ''}
        self.tree.insert('', index, iid=iid, text=url, values=(CHK_OFF, '', '', ''))
        self._set_item(iid)
        return iid

    def _set_item(self, iid, **changes):
        item = self.items.get(iid)
        if not item:
            return
        item.update(changes)
        status = item['status']
        label = item.get('title') or item['url']
        if status == ST_DONE and item.get('file'):
            label = os.path.basename(item['file'])
        pct = item.get('pct') or 0
        if status == ST_DOWNLOADING and pct:
            pct_text = f'{pct:.0f}%'
        elif status == ST_DONE:
            pct_text = '100%'
        else:
            pct_text = ''
        speed_text = ''
        if status == ST_DOWNLOADING:
            bits = [b for b in (item.get('speed'), ('ETA ' + item['eta']) if item.get('eta') else '') if b]
            speed_text = '  '.join(bits)
        elif status == ST_ERROR and item.get('error'):
            speed_text = '⚠ double-click for details'
        tag = status if status in (ST_DONE, ST_ERROR, ST_DOWNLOADING, ST_STOPPED) else ''
        self.tree.item(iid, text=label, tags=(tag,) if tag else ())
        self.tree.set(iid, 'status', STATUS_LABEL[status])
        self.tree.set(iid, 'progress', pct_text)
        self.tree.set(iid, 'speed', speed_text)

    def _next_pending(self):
        for iid in self.tree.get_children():
            if iid in self.active:
                continue
            if self.items[iid]['status'] in RESUMABLE_STATUSES:
                return iid
        return None

    def _has_pending(self):
        return any(it['status'] in RESUMABLE_STATUSES for it in self.items.values())

    def _update_overall(self):
        total = len(self.items)
        done = sum(1 for it in self.items.values() if it['status'] == ST_DONE)
        err = sum(1 for it in self.items.values() if it['status'] == ST_ERROR)
        pend = sum(1 for it in self.items.values() if it['status'] in RESUMABLE_STATUSES)
        if not total:
            self.overall_var.set('')
            return
        parts = [f'{done}/{total} done']
        if self.active:
            parts.append(f'{len(self.active)} active')
        if pend:
            parts.append(f'{pend} queued')
        if err:
            parts.append(f'{err} failed')
        self.overall_var.set('  ·  '.join(parts))

    def _remove_selected(self):
        targets = self._targets(self.tree)
        if not targets:
            return
        for iid in targets:
            url = self.items.get(iid, {}).get('url')
            if iid in self.active:                 # remove an in-flight download
                self._cancelling.add(iid)
                proc = self.active.get(iid)
                if proc and proc.poll() is None:
                    try:
                        proc.terminate()
                    except OSError:
                        pass
            self.items.pop(iid, None)
            self.tree._checked.discard(iid)
            self.tree.delete(iid)
            if url:
                _remove_link(LINKS_TO_DOWNLOAD, url)
        self._rebuild_to_download_file()
        self._update_overall()

    def _retry_selected(self):
        changed = False
        for iid in self._targets(self.tree):
            item = self.items.get(iid)
            if item and item['status'] in (ST_ERROR, ST_DONE, ST_STOPPED):
                self._set_item(iid, status=ST_QUEUED, pct=0, error='', speed='', eta='')
                _remove_link(LINKS_FAILED, item['url'])
                _remove_link(LINKS_DOWNLOADED, item['url'])
                changed = True
        if changed:
            self._rebuild_to_download_file()
            self._update_overall()
            self._pump()
            if not self.is_running and self._next_pending():
                self.status_var.set('Items re-queued. Press Start to download.')

    def _clear_finished(self):
        for iid in list(self.tree.get_children()):
            if self.items[iid]['status'] == ST_DONE:
                self.items.pop(iid, None)
                self.tree._checked.discard(iid)
                self.tree.delete(iid)
        self._update_overall()

    def _move_targets(self, index):
        for iid in self._targets(self.tree):
            self.tree.move(iid, '', index)
        self._rebuild_to_download_file()

    # ── "download now" (top of queue + start immediately) ─────────────
    def _start_or_pump(self):
        if not self.is_running or self.paused:
            self._start()
        else:
            self._pump()

    def _promote_and_start(self, iids):
        """Move the given rows to the top, re-queueing finished/failed ones."""
        promoted = 0
        for iid in iids:
            it = self.items.get(iid)
            if not it:
                continue
            if it['status'] in (ST_ERROR, ST_DONE):
                self._set_item(iid, status=ST_QUEUED, pct=0, error='', speed='', eta='')
                _remove_link(LINKS_FAILED, it['url'])
                _remove_link(LINKS_DOWNLOADED, it['url'])
            self.tree.move(iid, '', promoted)
            promoted += 1
        if promoted:
            self._rebuild_to_download_file()
            self._update_overall()
        return promoted

    def _download_now(self):
        """Put the box URLs (or, if none, the ticked/selected rows) on top and start now."""
        raw = [l.strip() for l in self.url_text.get('1.0', 'end').splitlines()]
        added = self._queue_urls(raw, at_top=True)
        if added:
            self.url_text.delete('1.0', 'end')
        elif not self._promote_and_start(self._targets(self.tree)) and not self._next_pending():
            messagebox.showinfo('Nothing to download', 'Paste a URL or tick a queue row first.')
            return
        self._start_or_pump()
        self.status_var.set('⚡ Downloading now…')

    def _download_now_rows(self):
        """Context-menu action: download the ticked/selected rows immediately."""
        if self._promote_and_start(self._targets(self.tree)):
            self._start_or_pump()
            self.status_var.set('⚡ Downloading now…')

    def _clear_errored(self):
        """Remove every failed row from the queue and from link_failed.txt."""
        n = 0
        for iid in list(self.tree.get_children()):
            it = self.items.get(iid)
            if it and it['status'] == ST_ERROR:
                _remove_link(LINKS_FAILED, it['url'])
                self.items.pop(iid, None)
                self.tree._checked.discard(iid)
                self.tree.delete(iid)
                n += 1
        self._update_overall()
        self._refresh_errored()
        self.status_var.set(f'Cleared {n} errored item(s).')

    # ── stall watchdog: skip downloads that produce no output for N s ──
    def _start_timeout(self):
        try:
            return max(0, int(self.start_timeout.get()))
        except (tk.TclError, ValueError):
            return 0

    def _check_timeouts(self):
        timeout = self._start_timeout()
        if timeout <= 0 or not self.active:
            return
        now = time.monotonic()
        for iid in list(self.active):
            if iid in self._cancelling or iid in self._timeouts:
                continue
            if now - self._activity.get(iid, now) > timeout:
                self._timeouts.add(iid)
                if iid in self.items:
                    self.items[iid]['error'] = f'timed out — no output for {timeout}s'
                    self._console_log(f'⏱ timeout  {self.items[iid]["url"]}  (no output for {timeout}s)')
                proc = self.active.get(iid)
                if proc and proc.poll() is None:
                    try:
                        proc.terminate()
                    except OSError:
                        pass

    def _popup_menu(self, event):
        iid = self.tree.identify_row(event.y)
        if iid and iid not in self.tree.selection():
            self.tree.selection_set(iid)
        if self.tree.selection() or self._targets(self.tree):
            try:
                self.ctx_menu.tk_popup(event.x_root, event.y_root)
            finally:
                self.ctx_menu.grab_release()

    # ── drag-to-reorder ───────────────────────────────────────────────
    def _on_tree_press(self, event):
        if self.tree.identify_column(event.x) == '#1':   # don't drag from the tick-box
            self._drag_iid = None
        else:
            self._drag_iid = self.tree.identify_row(event.y)

    def _on_tree_motion(self, event):
        if not self._drag_iid:
            return
        target = self.tree.identify_row(event.y)
        if target and target != self._drag_iid:
            self.tree.move(self._drag_iid, '', self.tree.index(target))

    def _on_tree_release(self, event):
        if self._drag_iid:
            self._drag_iid = None
            self._rebuild_to_download_file()

    # ── run control (parallel scheduler) ──────────────────────────────
    def _parallel(self):
        try:
            return max(1, min(10, int(self.max_parallel.get())))
        except (tk.TclError, ValueError):
            return 1

    def _build_env(self):
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        env['APHRO_DOWNLOADS_DIR'] = str(self._out_dir_path)
        browser = self._config.get('cookies_from_browser', '')
        if browser:
            env['BULK_COOKIES_FROM_BROWSER'] = browser
        elif COOKIES_FILE.exists():
            env['BULK_COOKIES_FILE'] = str(COOKIES_FILE)
        return env

    def _start(self):
        if self.is_running and not self.paused:
            return
        if not SCRIPT_PATH.exists():
            messagebox.showerror('Not found', f'Could not find {SCRIPT_PATH}')
            return
        if not self._next_pending():
            messagebox.showinfo('Empty queue', 'Add some URLs to the queue first.')
            return
        out_dir = Path(self.out_dir.get())
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            messagebox.showerror('Invalid folder', str(e))
            return

        self._out_dir_path = out_dir
        self._env = self._build_env()
        self.is_running = True
        self.paused = False
        self._update_controls()
        self._pump()

    def _pause(self):
        if not self.is_running or self.paused:
            return
        self.paused = True
        for iid, proc in list(self.active.items()):
            self._cancelling.add(iid)
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except OSError:
                    pass
        self._update_controls()
        self.status_var.set('Pausing… active downloads stop and resume from their .part files.')

    def _update_controls(self):
        if not self.is_running:
            self.start_btn.configure(state='normal', text='▶  Start')
            self.pause_btn.configure(state='disabled')
        elif self.paused:
            self.start_btn.configure(state='normal', text='▶  Resume')
            self.pause_btn.configure(state='disabled')
        else:
            self.start_btn.configure(state='disabled', text='▶  Start')
            self.pause_btn.configure(state='normal')

    def _pump(self):
        """Main-thread scheduler: keep up to N downloads running. Safe because all
        tree/order access happens here on the UI thread; workers only download."""
        if not self.is_running or self.paused:
            return
        while len(self.active) < self._parallel():
            iid = self._next_pending()
            if not iid:
                break
            self._launch(iid)
        if not self.active and not self._next_pending():
            self.is_running = False
            self.paused = False
            self._update_controls()
            self.status_var.set('✅ All downloads finished.' if not self._has_pending()
                                else 'Paused — items remain in the queue.')
        elif self.active:
            self.status_var.set(f'⬇ Downloading {len(self.active)} item(s)…')
        self._update_overall()

    def _launch(self, iid):
        self._set_item(iid, status=ST_DOWNLOADING, pct=0, speed='', eta='', error='')
        self.active[iid] = None
        self._activity[iid] = time.monotonic()
        self._rebuild_to_download_file()
        url = self.items[iid]['url']
        self._console_log(f'▶ start   {url}')
        threading.Thread(target=self._download_worker, args=(iid, url), daemon=True).start()

    def _download_worker(self, iid, url):
        code, result_file = self._run_download(iid, url, self._out_dir_path, self._env)
        self.out_queue.put(('done', iid, code, result_file))

    def _run_download(self, iid, url, out_dir, env):
        cmd = [_python_bin(), '-u', str(SCRIPT_PATH), '--url', url, '--out-dir', str(out_dir)]
        try:
            proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace',
                env=env, cwd=str(PROJECT_ROOT), **_subprocess_flags(),
            )
        except OSError as e:
            self.items[iid]['error'] = f'failed to launch downloader: {e}'
            return -1, None
        self.active[iid] = proc
        if iid in self._cancelling:        # paused/removed during the launch window
            try:
                proc.terminate()
            except OSError:
                pass

        result_file, last = None, ''
        for line in _read_stream(proc.stdout):
            line = line.strip()
            if not line:
                continue
            m = PROGRESS_RE.search(line)
            if m:
                sp = SPEED_RE.search(line)
                eta = ETA_RE.search(line)
                self.out_queue.put(('progress', iid, float(m.group(1)),
                                    (sp.group(1) if sp else '', eta.group(1) if eta else '')))
                continue
            mt = TITLE_RE.search(line)
            if mt:
                self.out_queue.put(('title', iid, mt.group(1), None))
            elif line.startswith('RESULT_FILE:'):
                result_file = line.split(':', 1)[1].strip()
            elif not line.startswith('RESULT_'):
                last = line
        code = proc.wait()
        if code != 0 and last:
            self.items[iid]['error'] = last
        return code, result_file

    # ════════════════════════════════════════════════════════════════
    #  Bookmarks tab
    # ════════════════════════════════════════════════════════════════
    def _build_bookmarks_tab(self, parent):
        pad = {'padx': 12, 'pady': 6}

        head = ttk.Frame(parent)
        head.pack(fill='x', **pad)
        ttk.Label(head, text='Import browser bookmarks', style='Header.TLabel').pack(anchor='w')
        ttk.Label(head, text='Reads Firefox + Chrome/Edge/Brave bookmarks live and keeps only the ones '
                             'matching a site in websites.json.', style='Sub.TLabel').pack(anchor='w')

        src = ttk.Frame(parent)
        src.pack(fill='x', **pad)
        ttk.Button(src, text='🦊 Load Firefox',
                   command=lambda: self._load_bookmarks('firefox')).pack(side='left')
        ttk.Button(src, text='🌐 Load Chrome/Edge/Brave',
                   command=lambda: self._load_bookmarks('chromium')).pack(side='left', padx=6)
        ttk.Button(src, text='📚 Load all', style='Accent.TButton',
                   command=lambda: self._load_bookmarks('all')).pack(side='left')
        self.bm_count_var = tk.StringVar(value='')
        ttk.Label(src, textvariable=self.bm_count_var, style='Count.TLabel').pack(side='right')

        filt = ttk.Frame(parent)
        filt.pack(fill='x', **pad)
        ttk.Label(filt, text='Filter:').pack(side='left')
        self.bm_filter_var = tk.StringVar()
        self.bm_filter_var.trace_add('write', lambda *_: self._refilter_bookmarks())
        ttk.Entry(filt, textvariable=self.bm_filter_var).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(filt, text='⤴ Add to top',
                   command=lambda: self._add_bookmarks_to_queue(at_top=True)).pack(side='left')
        ttk.Button(filt, text='⤵ Add to bottom', style='Accent.TButton',
                   command=lambda: self._add_bookmarks_to_queue(at_top=False)).pack(side='left', padx=6)

        list_panel = ttk.LabelFrame(parent, text='Matching bookmarks  ·  tick rows (or add all when none ticked)')
        list_panel.pack(fill='both', expand=True, **pad)
        list_inner = ttk.Frame(list_panel)
        list_inner.pack(fill='both', expand=True, padx=8, pady=8)

        self.bm_tree = ttk.Treeview(list_inner, columns=('chk', 'site', 'url'),
                                    show='tree headings', selectmode='extended')
        self.bm_tree.heading('#0', text='Title')
        self.bm_tree.heading('site', text='Site')
        self.bm_tree.heading('url', text='URL')
        self.bm_tree.column('#0', width=300, stretch=True)
        self.bm_tree.column('chk', width=34, anchor='center', stretch=False)
        self.bm_tree.column('site', width=110, stretch=False)
        self.bm_tree.column('url', width=340, stretch=True)
        bm_scroll = ttk.Scrollbar(list_inner, command=self.bm_tree.yview)
        self.bm_tree.configure(yscrollcommand=bm_scroll.set)
        self.bm_tree.pack(side='left', fill='both', expand=True)
        bm_scroll.pack(side='right', fill='y')
        self._setup_checktree(self.bm_tree)

    def _load_bookmarks(self, source):
        self.bm_count_var.set('Reading bookmarks…')
        self.status_var.set('Reading browser bookmarks…')
        threading.Thread(target=self._read_bookmarks_thread, args=(source,), daemon=True).start()

    def _read_bookmarks_thread(self, source):
        matchers = _build_site_matchers(self.sites_raw)
        raw = []
        if source in ('firefox', 'all'):
            for _label, path in _firefox_places_files():
                raw.extend(_read_firefox_bookmarks(path))
        if source in ('chromium', 'all'):
            for _label, path in _chromium_bookmark_files():
                raw.extend(_read_chromium_bookmarks(path))

        results, seen = [], set()
        for title, url in raw:
            if url in seen:
                continue
            site = _match_host(_host_of(url), matchers)
            if not site:
                continue
            seen.add(url)
            results.append({'site': site, 'title': title or url, 'url': url})
        results.sort(key=lambda r: (r['site'].lower(), r['title'].lower()))
        self.out_queue.put(('bookmarks', None, results, None))

    def _populate_bookmarks(self, results):
        self._all_bookmarks = results
        self._refilter_bookmarks()
        self.status_var.set(f'Found {len(results)} bookmark(s) matching websites.json.')

    def _refilter_bookmarks(self):
        needle = self.bm_filter_var.get().strip().lower()
        self.bm_tree._checked.clear()
        for iid in self.bm_tree.get_children():
            self.bm_tree.delete(iid)
        shown = 0
        for i, bm in enumerate(self._all_bookmarks):
            if needle and needle not in bm['title'].lower() \
                    and needle not in bm['url'].lower() and needle not in bm['site'].lower():
                continue
            self.bm_tree.insert('', 'end', iid=f'bm{i}', text=bm['title'],
                                values=(CHK_OFF, bm['site'], bm['url']))
            shown += 1
        total = len(self._all_bookmarks)
        self.bm_count_var.set(f'{shown} shown / {total} matched' if total else 'No bookmarks loaded')

    def _add_bookmarks_to_queue(self, at_top=False):
        rows = self._targets(self.bm_tree, fallback_all=True)
        urls = [self.bm_tree.set(iid, 'url') for iid in rows]
        urls = [u for u in urls if u]
        if not urls:
            messagebox.showinfo('Nothing to add', 'Load and tick some bookmarks first.')
            return
        added = self._queue_urls(urls, at_top=at_top)
        where = 'top' if at_top else 'bottom'
        if added:
            self.status_var.set(f'Added {added} bookmark(s) to the {where} of the queue.')
            self._pump()
            self.nb.select(self.tab_downloads)
        else:
            messagebox.showinfo('Already queued', 'Those bookmarks are already in the queue.')

    # ════════════════════════════════════════════════════════════════
    #  Search tab
    # ════════════════════════════════════════════════════════════════
    def _build_search_tab(self, parent):
        pad = {'padx': 12, 'pady': 6}

        head = ttk.Frame(parent)
        head.pack(fill='x', **pad)
        ttk.Label(head, text='Search sites in your browser', style='Header.TLabel').pack(anchor='w')
        ttk.Label(head, text='Type a query, then double-click a site to open its search — or open every '
                             '★ favourite at once.', style='Sub.TLabel').pack(anchor='w')

        bar = ttk.Frame(parent)
        bar.pack(fill='x', **pad)
        ttk.Label(bar, text='Query:').pack(side='left')
        self.search_query = tk.StringVar()
        q_entry = ttk.Entry(bar, textvariable=self.search_query)
        q_entry.pack(side='left', fill='x', expand=True, padx=6)
        q_entry.bind('<Return>', lambda e: self._open_all_favourites())
        ttk.Button(bar, text='⭐ Open all favourites', style='Accent.TButton',
                   command=self._open_all_favourites).pack(side='left')

        sub = ttk.Frame(parent)
        sub.pack(fill='x', padx=12)
        ttk.Label(sub, text='Click the ★ to favourite a site · double-click a row (or tick + button) to search.',
                  style='Sub.TLabel').pack(side='left')
        ttk.Button(sub, text='↗ Search ticked', command=self._open_ticked_search).pack(side='right')

        list_panel = ttk.LabelFrame(parent, text='Sites with search')
        list_panel.pack(fill='both', expand=True, **pad)
        list_inner = ttk.Frame(list_panel)
        list_inner.pack(fill='both', expand=True, padx=8, pady=8)

        self.search_tree = ttk.Treeview(list_inner, columns=('chk', 'fav', 'url'),
                                        show='tree headings', selectmode='extended')
        self.search_tree.heading('#0', text='Website')
        self.search_tree.heading('fav', text='★')
        self.search_tree.heading('url', text='Search URL')
        self.search_tree.column('#0', width=200, stretch=False)
        self.search_tree.column('chk', width=34, anchor='center', stretch=False)
        self.search_tree.column('fav', width=40, anchor='center', stretch=False)
        self.search_tree.column('url', width=480, stretch=True)
        s_scroll = ttk.Scrollbar(list_inner, command=self.search_tree.yview)
        self.search_tree.configure(yscrollcommand=s_scroll.set)
        self.search_tree.pack(side='left', fill='both', expand=True)
        s_scroll.pack(side='right', fill='y')
        self.search_tree.tag_configure('fav', foreground=GOLD)
        self._setup_checktree(self.search_tree)
        self.search_tree.bind('<Button-1>', self._on_search_click, add='+')
        self.search_tree.bind('<Double-1>', self._on_search_double)

        self._populate_search_sites()

    def _populate_search_sites(self):
        self.search_tree._checked.clear()
        for iid in self.search_tree.get_children():
            self.search_tree.delete(iid)
        for idx, s in enumerate(self.sites_raw):
            if not (s.get('searchURL') or '').strip():
                continue
            fav = bool(s.get('favourite'))
            self.search_tree.insert('', 'end', iid=f'site{idx}',
                                    text=s.get('name') or _host_of(s.get('url') or ''),
                                    values=(CHK_OFF, '★' if fav else '☆', s.get('searchURL') or ''),
                                    tags=('fav',) if fav else ())

    def _on_search_click(self, event):
        if self.search_tree.identify_region(event.x, event.y) != 'cell':
            return None
        if self.search_tree.identify_column(event.x) != '#2':   # the ★ column
            return None
        iid = self.search_tree.identify_row(event.y)
        if iid:
            self._toggle_favourite(iid)
            return 'break'
        return None

    def _toggle_favourite(self, iid):
        try:
            idx = int(iid[4:])
        except ValueError:
            return
        s = self.sites_raw[idx]
        s['favourite'] = not bool(s.get('favourite'))
        fav = s['favourite']
        self.search_tree.set(iid, 'fav', '★' if fav else '☆')
        self.search_tree.item(iid, tags=('fav',) if fav else ())
        if _save_websites_raw(self.sites_raw):
            n = sum(1 for x in self.sites_raw if x.get('favourite'))
            self.status_var.set(f'{"★ Favourited" if fav else "☆ Unfavourited"} {s.get("name")}  ·  {n} favourite(s).')
        else:
            self.status_var.set('Could not write websites.json (read-only?).')

    def _on_search_double(self, event):
        iid = self.search_tree.identify_row(event.y)
        if iid:
            self._open_site_search(iid)

    def _open_ticked_search(self):
        rows = self._targets(self.search_tree)
        if not rows:
            messagebox.showinfo('No site selected', 'Tick or select one or more sites first.')
            return
        for iid in rows:
            self._open_site_search(iid)

    def _open_site_search(self, iid):
        try:
            idx = int(iid[4:])
        except ValueError:
            return
        s = self.sites_raw[idx]
        search_url = (s.get('searchURL') or '').strip()
        if not search_url:
            return
        q = self.search_query.get().strip()
        full = search_url + urllib.parse.quote(q) if q else (s.get('url') or search_url)
        webbrowser.open(full, new=2)
        self.status_var.set(f'Opened {s.get("name")} search in browser.')

    def _open_all_favourites(self):
        q = self.search_query.get().strip()
        favs = [s for s in self.sites_raw if s.get('favourite') and (s.get('searchURL') or '').strip()]
        if not favs:
            messagebox.showinfo('No favourites', 'Click the ★ next to some sites to favourite them first.')
            return
        if not q:
            messagebox.showinfo('Enter a query', 'Type something to search for.')
            return
        if len(favs) > 8 and not messagebox.askyesno(
                'Open many tabs', f'This will open {len(favs)} browser tabs. Continue?'):
            return
        for s in favs:
            webbrowser.open(s['searchURL'].strip() + urllib.parse.quote(q), new=2)
        self.status_var.set(f'Opened {len(favs)} favourite search tab(s) for “{q}”.')

    # ════════════════════════════════════════════════════════════════
    #  Gallery tab
    # ════════════════════════════════════════════════════════════════
    def _build_gallery_tab(self, parent):
        pad = {'padx': 12, 'pady': 6}

        bar = ttk.Frame(parent)
        bar.pack(fill='x', **pad)
        ttk.Button(bar, text='🔄 Refresh', style='Accent.TButton',
                   command=self._refresh_gallery).pack(side='left')
        ttk.Button(bar, text='📂 Open folder',
                   command=lambda: self._open_path(Path(self.out_dir.get()))).pack(side='left', padx=6)
        self.gallery_info = tk.StringVar(value='Press Refresh to scan the download folder.')
        ttk.Label(bar, textvariable=self.gallery_info, style='Count.TLabel').pack(side='right')

        wrap = ttk.Frame(parent)
        wrap.pack(fill='both', expand=True, padx=12, pady=(0, 8))
        self.gallery_canvas = tk.Canvas(wrap, bg=BG, highlightthickness=0)
        g_scroll = ttk.Scrollbar(wrap, orient='vertical', command=self.gallery_canvas.yview)
        self.gallery_canvas.configure(yscrollcommand=g_scroll.set)
        self.gallery_canvas.pack(side='left', fill='both', expand=True)
        g_scroll.pack(side='right', fill='y')

        self.gallery_inner = ttk.Frame(self.gallery_canvas)
        self._gallery_window = self.gallery_canvas.create_window((0, 0), window=self.gallery_inner, anchor='nw')
        self.gallery_inner.bind('<Configure>',
                                lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox('all')))
        self.gallery_canvas.bind('<Configure>', self._on_gallery_configure)
        # Scope the mousewheel to when the pointer is actually over the gallery.
        self.gallery_canvas.bind('<Enter>', lambda e: self._gallery_wheel_bind(True))
        self.gallery_canvas.bind('<Leave>', lambda e: self._gallery_wheel_bind(False))

    def _gallery_wheel_bind(self, on):
        events = ('<MouseWheel>', '<Button-4>', '<Button-5>')
        for ev in events:
            if on:
                self.gallery_canvas.bind_all(ev, self._on_gallery_wheel)
            else:
                self.gallery_canvas.unbind_all(ev)

    def _on_gallery_configure(self, event):
        self.gallery_canvas.itemconfigure(self._gallery_window, width=event.width)
        self._gallery_reflow(event.width)

    def _on_gallery_wheel(self, event):
        if getattr(event, 'num', None) == 4:
            delta = 1
        elif getattr(event, 'num', None) == 5:
            delta = -1
        else:
            delta = int(event.delta / 120) if event.delta else 0
        self.gallery_canvas.yview_scroll(-delta, 'units')

    def _gallery_reflow(self, width=None):
        if width is None:
            width = self.gallery_canvas.winfo_width()
        cols = max(1, width // CARD_W)
        if cols == self._gallery_cols and self._gallery_cards:
            return
        self._gallery_cols = cols
        for i, card in enumerate(self._gallery_cards):
            card.grid(row=i // cols, column=i % cols, padx=8, pady=8, sticky='n')

    def _refresh_gallery(self):
        folder = Path(self.out_dir.get())
        self._gallery_gen += 1
        gen = self._gallery_gen
        for child in self.gallery_inner.winfo_children():
            child.destroy()
        self._gallery_cards = []
        self._gallery_thumb_labels = []
        self._gallery_imgs = []
        self._gallery_cols = 0

        if not folder.is_dir():
            self.gallery_info.set('Download folder does not exist yet.')
            return
        try:
            files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTS]
        except OSError as e:
            self.gallery_info.set(f'Cannot read folder: {e}')
            return
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        truncated = len(files) > GALLERY_MAX
        files = files[:GALLERY_MAX]

        if not files:
            self.gallery_info.set('No videos in the download folder.')
            return

        ffmpeg = _find_ffmpeg()
        for path in files:
            card = ttk.Frame(self.gallery_inner, style='Card.TFrame')
            blank = tk.PhotoImage(width=THUMB_W, height=THUMB_H)
            self._gallery_imgs.append(blank)
            thumb = tk.Label(card, image=blank, bg='#e5e7eb',
                             text=('' if ffmpeg else '🎬'), width=THUMB_W, height=THUMB_H, compound='center')
            thumb.pack()
            name = path.name if len(path.name) <= 40 else path.name[:37] + '…'
            ttk.Label(card, text=name, style='CardName.TLabel', wraplength=THUMB_W).pack(fill='x', padx=4, pady=(4, 0))
            ttk.Label(card, text=_human_size(path), style='CardSub.TLabel').pack(fill='x', padx=4, pady=(0, 4))
            self._bind_open(card, path)
            self._bind_open(thumb, path)
            self._gallery_cards.append(card)
            self._gallery_thumb_labels.append(thumb)

        self._gallery_reflow()
        note = f'  ·  showing first {GALLERY_MAX}' if truncated else ''
        ffnote = '' if ffmpeg else '  ·  ffmpeg not found, thumbnails disabled'
        self.gallery_info.set(f'{len(files)} video(s){note}{ffnote}  ·  double-click to play')

        if ffmpeg:
            threading.Thread(target=self._gallery_thumb_thread,
                             args=(ffmpeg, list(files), gen), daemon=True).start()

    def _gallery_thumb_thread(self, ffmpeg, files, gen):
        try:
            THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        except OSError:
            return
        for idx, path in enumerate(files):
            if gen != self._gallery_gen:
                return
            png = _thumb_path(path)
            if not png.exists():
                _make_thumb(ffmpeg, path, png)
            if png.exists():
                self.out_queue.put(('gthumb', gen, idx, str(png)))

    def _bind_open(self, widget, path):
        widget.bind('<Double-Button-1>', lambda e, p=path: self._open_file(p))

    # ════════════════════════════════════════════════════════════════
    #  X.com login tab
    # ════════════════════════════════════════════════════════════════
    def _build_xlogin_tab(self, parent):
        pad = {'padx': 12, 'pady': 6}

        head = ttk.Frame(parent)
        head.pack(fill='x', **pad)
        ttk.Label(head, text='X.com login', style='Header.TLabel').pack(anchor='w')
        ttk.Label(head, text='Sensitive / login-gated X.com videos need your login. Pick ONE method below.',
                  style='Sub.TLabel').pack(anchor='w')

        self.cookie_status_var = tk.StringVar(value=_cookie_status(self._config))
        ttk.Label(parent, textvariable=self.cookie_status_var, style='Status.TLabel',
                  wraplength=900).pack(anchor='w', padx=12, pady=(0, 4))

        # Method 1 — browser login (recommended)
        m1 = ttk.LabelFrame(parent, text='① Recommended: use your browser login (no copy-paste)')
        m1.pack(fill='x', **pad)
        ttk.Label(m1, text='Stay logged in to x.com in your browser; yt-dlp reads its cookies live.',
                  style='Sub.TLabel').pack(anchor='w', padx=8, pady=(6, 2))
        m1row = ttk.Frame(m1)
        m1row.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Label(m1row, text='Browser:').pack(side='left')
        self.browser_var = tk.StringVar(value=self._config.get('cookies_from_browser') or 'firefox')
        ttk.Combobox(m1row, textvariable=self.browser_var, values=BROWSER_CHOICES,
                     state='readonly', width=12).pack(side='left', padx=6)
        ttk.Button(m1row, text='✓ Use this browser login', style='Accent.TButton',
                   command=self._use_browser_login).pack(side='left')
        ttk.Button(m1row, text='Stop using browser login',
                   command=self._clear_browser_login).pack(side='left', padx=6)

        # Method 2 — paste tokens, with a step-by-step guide
        m2 = ttk.LabelFrame(parent, text='② Paste tokens')
        m2.pack(fill='x', **pad)
        guide = (
            'Step-by-step:\n'
            '  1.  Open  https://x.com  in your browser and log in.\n'
            '  2.  Press  F12  to open Developer Tools.\n'
            '  3.  Open the “Application” tab (Chrome/Edge) or “Storage” tab (Firefox).\n'
            '  4.  In the left sidebar expand  Cookies  →  click  https://x.com.\n'
            '  5.  Find the row named  auth_token  →  copy its Value into the field below.\n'
            '  6.  Find the row named  ct0  →  copy its Value into the field below.\n'
            '  7.  Click  “Save tokens”.'
        )
        ttk.Label(m2, text=guide, style='Guide.TLabel', justify='left').pack(anchor='w', padx=8, pady=(6, 4))
        tok = ttk.Frame(m2)
        tok.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Label(tok, text='auth_token:').grid(row=0, column=0, sticky='w', pady=3)
        self.auth_token_var = tk.StringVar()
        ttk.Entry(tok, textvariable=self.auth_token_var).grid(row=0, column=1, sticky='we', padx=6, pady=3)
        ttk.Label(tok, text='ct0:').grid(row=1, column=0, sticky='w', pady=3)
        self.ct0_var = tk.StringVar()
        ttk.Entry(tok, textvariable=self.ct0_var).grid(row=1, column=1, sticky='we', padx=6, pady=3)
        tok.columnconfigure(1, weight=1)
        ttk.Button(tok, text='💾 Save tokens', command=self._save_tokens).grid(row=2, column=1, sticky='e', pady=(4, 0))

        # Method 3 — cookies.txt file
        m3 = ttk.LabelFrame(parent, text='③ Import a cookies.txt')
        m3.pack(fill='both', expand=True, **pad)
        row = ttk.Frame(m3)
        row.pack(fill='x', padx=8, pady=(8, 4))
        ttk.Button(row, text='📄 Import cookies.txt…', command=self._import_cookies_file).pack(side='left')
        ttk.Button(row, text='🔎 Auto-detect', command=self._autodetect_cookies_action).pack(side='left', padx=6)
        ttk.Button(row, text='🗑 Clear cookies', style='Stop.TButton', command=self._clear_cookies).pack(side='left')
        raw_inner = ttk.Frame(m3)
        raw_inner.pack(fill='both', expand=True, padx=8, pady=4)
        ttk.Label(raw_inner, text='…or paste a raw Netscape cookies.txt:', style='Sub.TLabel').pack(anchor='w')
        self.raw_cookies_text = tk.Text(raw_inner, height=4, wrap='none', font=FONT_MONO,
                                        relief='flat', borderwidth=1, highlightthickness=1,
                                        highlightbackground=BORDER, highlightcolor=ACCENT)
        self.raw_cookies_text.pack(fill='both', expand=True, pady=(2, 4))
        ttk.Button(m3, text='💾 Save pasted cookies',
                   command=self._save_raw_cookies).pack(anchor='e', padx=8, pady=(0, 8))

    def _refresh_cookie_status(self):
        self.cookie_status_var.set(_cookie_status(self._config))

    def _use_browser_login(self):
        browser = self.browser_var.get().strip().lower()
        if browser not in BROWSER_CHOICES:
            return
        self._config['cookies_from_browser'] = browser
        self._save_config()
        self._refresh_cookie_status()
        self.status_var.set(f'Using {browser.title()} browser login for X.com.')
        messagebox.showinfo('Browser login set',
                            f'X.com downloads will use your {browser.title()} login.\n\n'
                            f'Make sure you are signed in to x.com in {browser.title()}, '
                            f'and that {browser.title()} is closed if it locks its cookie DB '
                            '(mainly Chrome/Edge on Windows).')

    def _clear_browser_login(self):
        self._config['cookies_from_browser'] = ''
        self._save_config()
        self._refresh_cookie_status()
        self.status_var.set('Browser login disabled.')

    def _import_cookies_file(self):
        path = filedialog.askopenfilename(
            title='Select X.com cookies.txt (Netscape format)',
            filetypes=[('Cookies file', '*.txt'), ('All files', '*.*')])
        if not path:
            return
        try:
            shutil.copyfile(path, COOKIES_FILE)
        except OSError as e:
            messagebox.showerror('Could not save cookies', str(e))
            return
        self._clear_browser_login_silent()
        self._refresh_cookie_status()
        self.status_var.set('X.com cookies imported.')

    def _clear_browser_login_silent(self):
        if self._config.get('cookies_from_browser'):
            self._config['cookies_from_browser'] = ''
            self._save_config()

    def _autodetect_cookies_action(self):
        self.status_var.set('Searching common folders for cookies…')
        threading.Thread(target=self._autodetect_thread, daemon=True).start()

    def _autodetect_thread(self):
        found = _autodetect_cookies()
        self.out_queue.put(('cookies_found', None, str(found) if found else '', None))

    def _clear_cookies(self):
        existed = COOKIES_FILE.exists()
        if existed:
            if not messagebox.askyesno('Clear cookies', 'Delete the saved X.com cookies?'):
                return
            try:
                COOKIES_FILE.unlink()
            except OSError as e:
                messagebox.showerror('Could not delete', str(e))
                return
        self._refresh_cookie_status()
        self.status_var.set('X.com cookies cleared.')

    def _save_tokens(self):
        auth = self.auth_token_var.get().strip()
        ct0 = self.ct0_var.get().strip()
        if not auth:
            messagebox.showinfo('Missing token', 'Paste at least the auth_token value.')
            return
        try:
            _write_x_cookies_from_tokens(auth, ct0)
        except OSError as e:
            messagebox.showerror('Could not save', str(e))
            return
        self._clear_browser_login_silent()
        self._refresh_cookie_status()
        self.status_var.set('X.com cookies built from tokens.')
        messagebox.showinfo('Saved', 'Login cookies built from your tokens — used automatically.')

    def _save_raw_cookies(self):
        text = self.raw_cookies_text.get('1.0', 'end').strip()
        if not text:
            messagebox.showinfo('Empty', 'Paste a Netscape cookies.txt first.')
            return
        if not text.startswith('# Netscape'):
            text = '# Netscape HTTP Cookie File\n' + text
        try:
            COOKIES_FILE.write_text(text + '\n', encoding='utf-8')
        except OSError as e:
            messagebox.showerror('Could not save', str(e))
            return
        self._clear_browser_login_silent()
        self._refresh_cookie_status()
        self.status_var.set('Pasted cookies saved.')

    # ── UI message pump ───────────────────────────────────────────────
    def _poll_queue(self):
        try:
            while True:
                kind, iid, a, b = self.out_queue.get_nowait()
                if kind == 'done':
                    self._handle_done(iid, a, b)
                elif kind == 'progress':
                    if iid in self.items:
                        sp, eta = b
                        self._set_item(iid, status=ST_DOWNLOADING, pct=a, speed=sp, eta=eta)
                elif kind == 'title':
                    if iid in self.items:
                        self._set_item(iid, title=a)
                elif kind == 'bookmarks':
                    self._populate_bookmarks(a)
                elif kind == 'gthumb':
                    self._apply_gallery_thumb(iid, a, b)
                elif kind == 'cookies_found':
                    self._handle_cookies_found(a)
        except queue.Empty:
            pass
        self.after(100, self._poll_queue)

    def _handle_done(self, iid, code, result_file):
        cancelled = iid in self._cancelling
        self._cancelling.discard(iid)
        self.active.pop(iid, None)
        if iid not in self.items:            # row was removed mid-download
            self._pump()
            return
        url = self.items[iid]['url']
        if cancelled:
            self._set_item(iid, status=ST_STOPPED)
        elif code == 0 and result_file:
            self._set_item(iid, status=ST_DONE, file=result_file, pct=100)
            self._mark_downloaded(url)
        else:
            self._set_item(iid, status=ST_ERROR)
            _append_link(LINKS_FAILED, url)
        self._rebuild_to_download_file()
        self._update_overall()
        self._pump()

    def _handle_cookies_found(self, path):
        if not path:
            self.status_var.set('No cookies.txt with x.com cookies found.')
            messagebox.showinfo('Nothing found',
                                'No cookies.txt with x.com/twitter cookies found in your '
                                'Downloads / Desktop / Documents / home folders.')
            return
        try:
            shutil.copyfile(path, COOKIES_FILE)
        except OSError as e:
            messagebox.showerror('Could not save cookies', str(e))
            return
        self._clear_browser_login_silent()
        self._refresh_cookie_status()
        self.status_var.set(f'Auto-detected cookies from {path}')
        messagebox.showinfo('Cookies found', f'Imported cookies from:\n{path}')

    def _apply_gallery_thumb(self, gen, idx, png):
        if gen != self._gallery_gen or not (0 <= idx < len(self._gallery_thumb_labels)):
            return
        try:
            img = tk.PhotoImage(file=png)
        except tk.TclError:
            return
        self._gallery_imgs.append(img)
        self._gallery_thumb_labels[idx].configure(image=img, text='')

    def _mark_downloaded(self, url):
        _remove_link(LINKS_TO_DOWNLOAD, url)
        _remove_link(LINKS_FAILED, url)
        _append_link(LINKS_DOWNLOADED, url, cap=DOWNLOADED_FILE_CAP)

    def _on_tab_changed(self, event=None):
        if self.nb.select() == str(self.tab_gallery) and not self._gallery_cards:
            self._refresh_gallery()

    # ── config persistence ────────────────────────────────────────────
    def _save_config(self):
        self._config['out_dir'] = self.out_dir.get()
        self._config['max_parallel'] = self._parallel()
        try:
            self._config['last_tab'] = self.nb.index(self.nb.select())
        except (tk.TclError, AttributeError):
            pass
        try:
            CONFIG_FILE.write_text(json.dumps(self._config, indent=2), encoding='utf-8')
        except OSError:
            pass

    # ── misc actions ──────────────────────────────────────────────────
    def _browse(self):
        d = filedialog.askdirectory(initialdir=self.out_dir.get() or str(PROJECT_ROOT))
        if d:
            self.out_dir.set(d)

    def _open_path(self, path):
        path = Path(path)
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        self._open_file(path)

    def _open_file(self, path):
        path = str(path)
        try:
            if sys.platform == 'win32':
                os.startfile(path)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', path])
            else:
                subprocess.Popen(['xdg-open', path])
        except OSError as e:
            messagebox.showerror('Could not open', str(e))

    def _open_selected_file(self, event=None):
        sel = self.tree.selection() or self._targets(self.tree)
        if not sel:
            return
        item = self.items.get(sel[0])
        if not item:
            return
        if item['status'] == ST_ERROR and item.get('error'):
            messagebox.showwarning('Download failed', item['error'][:2000])
            return
        if item.get('file') and os.path.exists(item['file']):
            self._open_file(item['file'])

    def _on_close(self):
        self.paused = True
        self.is_running = False
        for proc in list(self.active.values()):
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except OSError:
                    pass
        try:
            self._config['geometry'] = self.geometry()
        except tk.TclError:
            pass
        self._save_config()
        self.destroy()


# ── gallery thumbnail helpers ─────────────────────────────────────────

def _find_ffmpeg():
    names = ['ffmpeg.exe', 'ffmpeg'] if sys.platform == 'win32' else ['ffmpeg']
    for base in (PROJECT_ROOT, APP_DIR, PROJECT_ROOT / 'cache'):
        for n in names:
            p = base / n
            if p.is_file():
                return str(p)
    return shutil.which('ffmpeg')


def _thumb_path(video_path):
    try:
        mtime = video_path.stat().st_mtime
    except OSError:
        mtime = 0
    key = hashlib.md5(f'{video_path}|{mtime}'.encode('utf-8')).hexdigest()
    return THUMB_CACHE_DIR / f'{key}.png'


def _make_thumb(ffmpeg, video_path, out_png):
    base = [ffmpeg, '-y']
    tail = ['-frames:v', '1', '-vf', f'scale={THUMB_W}:-2', '-loglevel', 'error', str(out_png)]
    for seek in (['-ss', '3', '-i', str(video_path)], ['-i', str(video_path)]):
        try:
            subprocess.run(base + seek + tail, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=30, **_subprocess_flags())
        except (OSError, subprocess.SubprocessError):
            pass
        if out_png.exists():
            return


def _human_size(path):
    try:
        size = path.stat().st_size
    except OSError:
        return ''
    val = float(size)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if val < 1024 or unit == 'TB':
            return f'{val:.0f} {unit}' if unit == 'B' else f'{val:.1f} {unit}'
        val /= 1024
    return ''


if __name__ == '__main__':
    DownloadManager().mainloop()
