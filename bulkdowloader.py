import os
import re
import io
import sys
import gzip
import json
import zlib
import html
import argparse
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# Force UTF-8 stdout so the server process can always decode the output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

try:
    import yt_dlp
except ImportError:
    print('Installing yt-dlp...', flush=True)
    os.system(f'"{sys.executable}" -m pip install -U yt-dlp')
    import yt_dlp


# ════════════════════════════════════════════════════════════════════════
#  Constants
# ════════════════════════════════════════════════════════════════════════

USER_AGENT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36')

# Extensions that represent a directly-downloadable stream/file.
DIRECT_MEDIA_EXTS = (
    'm3u8', 'mpd', 'mp4', 'webm', 'mov', 'm4v', 'ts', 'flv', 'mkv',
    'avi', 'f4v', 'ogv', '3gp', 'wmv',
)
# Streaming-manifest extensions yt-dlp handles best.
MANIFEST_EXTS = ('m3u8', 'mpd')

# Hosts that almost always wrap an embeddable player worth recursing into.
EMBED_HOST_HINTS = (
    'youtube', 'youtu.be', 'vimeo', 'dailymotion', 'streamable', 'twitch',
    'jwplayer', 'jwplatform', 'brightcove', 'wistia', 'kaltura', 'vidyard',
    'players.', 'player.', 'embed.', 'iframe.', 'cdn.', 'video.',
    'streamtape', 'dood', 'mixdrop', 'fembed', 'vidoza', 'upstream',
    'mp4upload', 'streamsb', 'filemoon', 'voe', 'vtube', 'sendvid',
)


# ════════════════════════════════════════════════════════════════════════
#  Lightweight HTTP fetch (stdlib only — works without requests/bs4)
# ════════════════════════════════════════════════════════════════════════

def http_get(url, referer=None, timeout=25, max_bytes=8 * 1024 * 1024):
    """Fetch a page and return (final_url, text). Returns (url, '') on failure."""
    headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
    }
    if referer:
        headers['Referer'] = referer
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=timeout) as resp:
            final_url = resp.geturl()
            raw = resp.read(max_bytes)
            enc = (resp.headers.get('Content-Encoding') or '').lower()
            if 'gzip' in enc:
                try:
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
                except OSError:
                    pass
            elif 'deflate' in enc:
                try:
                    raw = zlib.decompress(raw)
                except zlib.error:
                    raw = zlib.decompress(raw, -zlib.MAX_WBITS)
            ctype = (resp.headers.get('Content-Type') or '')
            charset = 'utf-8'
            m = re.search(r'charset=([\w-]+)', ctype, re.I)
            if m:
                charset = m.group(1)
            return final_url, raw.decode(charset, errors='replace')
    except (URLError, HTTPError, OSError, ValueError) as e:
        print(f'   [scrape] fetch failed for {url}: {e}', flush=True)
        return url, ''


# ════════════════════════════════════════════════════════════════════════
#  Media-URL extraction from arbitrary HTML
# ════════════════════════════════════════════════════════════════════════

def _clean_url(raw):
    """Unescape a URL pulled out of HTML/JS (handles \\/ and HTML entities)."""
    if not raw:
        return ''
    u = raw.strip().strip('\'"')
    u = u.replace('\\/', '/').replace('\\u0026', '&').replace('\\u002F', '/')
    u = html.unescape(u)
    return u.strip()


def _looks_direct(url):
    path = urlparse(url).path.lower()
    return any(path.endswith('.' + e) or ('.' + e + '?') in url.lower() for e in DIRECT_MEDIA_EXTS)


def _is_manifest(url):
    path = urlparse(url).path.lower()
    return any(path.endswith('.' + e) for e in MANIFEST_EXTS) or '.m3u8' in url.lower() or '.mpd' in url.lower()


def _walk_jsonld(node, out):
    """Recursively pull contentUrl/embedUrl/url from JSON-LD VideoObject nodes."""
    if isinstance(node, dict):
        t = node.get('@type', '')
        types = t if isinstance(t, list) else [t]
        is_video = any('video' in str(x).lower() or 'media' in str(x).lower() for x in types)
        for key in ('contentUrl', 'embedUrl', 'url'):
            v = node.get(key)
            if isinstance(v, str) and v.startswith('http'):
                if is_video or _looks_direct(v):
                    out.append(v)
        for v in node.values():
            _walk_jsonld(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_jsonld(v, out)


def extract_candidates(base_url, page):
    """
    Parse a page for video sources. Returns two ordered, de-duplicated lists:
      direct  -> direct media / manifest URLs (download these first)
      embeds  -> iframe / player page URLs worth recursing into
    """
    direct, embeds, seen = [], [], set()

    def add(lst, raw, referer_hint=False):
        u = _clean_url(raw)
        if not u or u.startswith(('data:', 'blob:', 'javascript:', 'about:')):
            return
        u = urljoin(base_url, u)
        if not u.startswith('http'):
            return
        if u in seen:
            return
        seen.add(u)
        lst.append(u)

    # 1) Open Graph / Twitter player meta tags — highest signal.
    for pat in (
        r'<meta[^>]+(?:property|name)=["\'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["\']',
        r'<meta[^>]+itemprop=["\']contentURL["\'][^>]+(?:content|href)=["\']([^"\']+)["\']',
    ):
        for m in re.finditer(pat, page, re.I):
            add(direct if _looks_direct(m.group(1)) else embeds, m.group(1))

    # 2) JSON-LD structured data.
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                         page, re.I | re.S):
        try:
            data = json.loads(m.group(1).strip())
            found = []
            _walk_jsonld(data, found)
            for u in found:
                add(direct if _looks_direct(u) else embeds, u)
        except (json.JSONDecodeError, ValueError):
            continue

    # 3) <video> / <source> tags.
    for m in re.finditer(r'<video[^>]+src=["\']([^"\']+)["\']', page, re.I):
        add(direct, m.group(1))
    for m in re.finditer(r'<source[^>]+src=["\']([^"\']+)["\']', page, re.I):
        add(direct, m.group(1))

    # 4) Common JS player configs: jwplayer sources, "file"/"src"/"hls" keys, etc.
    for pat in (
        r'["\'](?:file|src|source|hls|url|playlist|manifestUrl|hlsManifestUrl|streamUrl)["\']\s*:\s*["\']([^"\']+\.(?:m3u8|mpd|mp4|webm|mov|m4v|ts)[^"\']*)["\']',
        r'sources?\s*:\s*\[\s*\{[^}]*?["\'](?:file|src)["\']\s*:\s*["\']([^"\']+)["\']',
        r'(?:setup|loadSource|src)\(\s*["\']([^"\']+\.(?:m3u8|mpd|mp4)[^"\']*)["\']',
    ):
        for m in re.finditer(pat, page, re.I):
            add(direct, m.group(1))

    # 5) Raw media URLs anywhere in the markup/scripts (incl. escaped slashes).
    raw_pat = r'(https?:(?:\\?/\\?/)[^"\'<>\s\\]+?\.(?:%s)(?:\?[^"\'<>\s\\]*)?)' % '|'.join(DIRECT_MEDIA_EXTS)
    for m in re.finditer(raw_pat, page, re.I):
        add(direct, m.group(1))

    # 6) iframes — recurse into them when nothing better is found.
    for m in re.finditer(r'<iframe[^>]+src=["\']([^"\']+)["\']', page, re.I):
        add(embeds, m.group(1))
    # data-src lazy iframes / embeds
    for m in re.finditer(r'data-(?:src|litespeed-src|lazy-src)=["\']([^"\']+)["\']', page, re.I):
        u = _clean_url(m.group(1))
        if u and (_looks_direct(u) or any(h in u.lower() for h in EMBED_HOST_HINTS)):
            add(direct if _looks_direct(u) else embeds, m.group(1))

    # Prefer manifests first within direct list (better quality/adaptive).
    direct.sort(key=lambda u: (0 if _is_manifest(u) else 1))
    return direct, embeds


def scrape_for_media(url, referer=None, depth=0, max_depth=2, seen_pages=None):
    """Walk a page (and its iframes) returning a list of downloadable media URLs."""
    if seen_pages is None:
        seen_pages = set()
    if url in seen_pages or depth > max_depth:
        return []
    seen_pages.add(url)

    final_url, page = http_get(url, referer=referer)
    if not page:
        return []

    direct, embeds = extract_candidates(final_url, page)
    if direct:
        return [(u, final_url) for u in direct]   # carry referer for download

    # Nothing direct here — descend into the most promising embeds.
    results = []
    ranked = sorted(embeds, key=lambda u: (0 if any(h in u.lower() for h in EMBED_HOST_HINTS) else 1))
    for emb in ranked[:6]:
        results.extend(scrape_for_media(emb, referer=final_url, depth=depth + 1,
                                        max_depth=max_depth, seen_pages=seen_pages))
        if results:
            break
    return results


# ════════════════════════════════════════════════════════════════════════
#  Downloader
# ════════════════════════════════════════════════════════════════════════

class UniversalVideoDownloader:
    _COLLISION_EXTS = DIRECT_MEDIA_EXTS

    def __init__(self, base_dir='video_downloads'):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(exist_ok=True)
        self.last_file = None

        self.default_opts = {
            'quiet': False,
            'no_warnings': False,
            'progress_hooks': [self._progress_hook],
            'http_headers': {'User-Agent': USER_AGENT},
            'restrictfilenames': True,
            'windowsfilenames': True,
            'overwrites': False,
            'ignoreerrors': False,      # we want exceptions so the waterfall can react
            'noplaylist': True,
            'writethumbnail': True,
            'writeinfojson': False,
            'writesubtitles': False,
            'embedthumbnail': False,
            'embedmetadata': True,
            'merge_output_format': 'mp4',
            'concurrent_fragment_downloads': 5,
            'retries': 10,
            'fragment_retries': 20,
            'extractor_retries': 5,
            'socket_timeout': 30,
            'hls_prefer_native': False,
        }

    # ── per-site tuning ──────────────────────────────────────────────────
    def get_site_specific_opts(self, url):
        u = url.lower()
        opts = {k: (v.copy() if isinstance(v, dict) else v) for k, v in self.default_opts.items()}

        if 'pornhub.com' in u:
            opts.update({'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                         'impersonate': 'chrome', 'prefer_free_formats': True, 'sleep_interval': 1})
        elif 'xvideos.com' in u or 'xvideos.red' in u:
            opts.update({'format': 'best[ext=mp4]/best'})
            opts['http_headers']['Referer'] = 'https://www.xvideos.com/'
        elif 'xhamster.com' in u:
            opts.update({'format': 'bestvideo+bestaudio/best', 'concurrent_fragment_downloads': 6})
        elif 'spankbang.com' in u:
            opts.update({'format': 'bestvideo+bestaudio/best', 'concurrent_fragment_downloads': 8})
        elif any(s in u for s in ('eporner.com', 'porntrex.com', 'hqporner.com')):
            opts.update({'format': 'bestvideo+bestaudio/best[ext=mp4]/best', 'concurrent_fragment_downloads': 6})
        elif any(s in u for s in ('youtube.com', 'youtu.be')):
            opts.update({'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best', 'impersonate': 'chrome'})
        elif 'x.com' in u or 'twitter.com' in u:
            opts.update({'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                         'extractor_args': {'twitter': {'api': ['graphql']}}, 'impersonate': 'chrome'})
        elif 'instagram.com' in u:
            opts.update({'format': 'bestvideo+bestaudio/best', 'impersonate': 'chrome'})
        elif 'tiktok.com' in u:
            opts.update({'format': 'best', 'impersonate': 'chrome'})
        elif 'reddit.com' in u:
            opts.update({'format': 'bestvideo+bestaudio/best'})
        else:
            opts.setdefault('format', 'bestvideo+bestaudio/best/best')
        return opts

    # ── filename helpers ─────────────────────────────────────────────────
    def _unique_stem(self, folder, stem):
        def exists(s):
            return any((folder / f'{s}.{e}').exists() for e in self._COLLISION_EXTS)
        if not exists(stem):
            return stem
        n = 1
        while exists(f'{stem}_{n}'):
            n += 1
        return f'{stem}_{n}'

    def get_folder_name(self, url):
        try:
            m = re.search(r'https?://(?:www\.)?([^/]+)', url)
            domain = (m.group(1).lower() if m else 'misc')
            domain = re.sub(r'\.(com|net|org|tv|me|xxx|io|co)$', '', domain).replace('www.', '')
            path = url.split(domain)[-1]
            sm = re.search(r'/([^/]{5,60}?)(?:[/?#]|$)', path)
            slug = re.sub(r'[^a-zA-Z0-9._-]', '_', sm.group(1)) if sm else ''
            return (f'{domain}_{slug}'.strip('_') if slug and len(slug) < 45 else domain.strip('_'))
        except Exception:
            return 'misc'

    # ── yt-dlp invocation ────────────────────────────────────────────────
    def _build_outtmpl(self, folder, url, out_tmpl):
        """Resolve a collision-free output template inside *folder*."""
        if out_tmpl is None:
            out_tmpl = '%(title)s.%(ext)s'
        tmpl = str(folder / out_tmpl)
        try:
            probe_opts = {**self.get_site_specific_opts(url), 'quiet': True,
                          'no_warnings': True, 'ignoreerrors': True}
            with yt_dlp.YoutubeDL(probe_opts) as probe:
                info = probe.extract_info(url, download=False)
            if info:
                stem = Path(probe.prepare_filename(info)).stem
                tmpl = str(folder / f'{self._unique_stem(folder, stem)}.%(ext)s')
        except Exception:
            pass
        return tmpl

    def _try_ytdlp(self, url, outtmpl, referer=None, force_generic=False, label='yt-dlp'):
        """Single yt-dlp attempt. Returns the downloaded path on success, else None."""
        opts = self.get_site_specific_opts(url)
        opts['outtmpl'] = outtmpl
        if referer:
            opts.setdefault('http_headers', {})['Referer'] = referer
        if force_generic:
            opts['force_generic_extractor'] = True
        self.last_file = None
        try:
            print(f'   [{label}] trying: {url}', flush=True)
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            return self._resolve_final_file()
        except Exception as e:
            print(f'   [{label}] failed: {e}', flush=True)
            return None

    def _resolve_final_file(self):
        """After a download, find the real media file (prefer merged mp4)."""
        if not self.last_file:
            return None
        p = Path(self.last_file)
        if p.exists():
            return str(p)
        # merge/remux may have changed the extension
        for e in ('mp4', 'mkv', 'webm', 'm4v', 'mov'):
            cand = p.with_suffix('.' + e)
            if cand.exists():
                return str(cand)
        return None

    # ── the universal waterfall ──────────────────────────────────────────
    def download(self, url, folder, out_tmpl=None):
        """
        Try every strategy in order until a video lands on disk.
        Returns the downloaded file path, or None.
        """
        folder.mkdir(parents=True, exist_ok=True)
        outtmpl = self._build_outtmpl(folder, url, out_tmpl)

        # 1) Native extractor for the URL as given.
        f = self._try_ytdlp(url, outtmpl, label='native')
        if f:
            return f

        # 2) Force yt-dlp's generic extractor (finds <video>, og:video, HLS…).
        f = self._try_ytdlp(url, outtmpl, force_generic=True, label='generic')
        if f:
            return f

        # 3) Scrape the page (and iframes) ourselves for media URLs.
        print('   [scrape] yt-dlp could not extract — scraping page for media…', flush=True)
        media = scrape_for_media(url)
        if media:
            print(f'   [scrape] found {len(media)} candidate(s)', flush=True)
        for cand_url, referer in media:
            f = self._try_ytdlp(cand_url, outtmpl, referer=referer, label='candidate')
            if f:
                return f
            # last resort: stream a plain http(s) file directly
            if _looks_direct(cand_url) and not _is_manifest(cand_url):
                f = self._direct_download(cand_url, folder, referer)
                if f:
                    return f

        print('   [error] no downloadable video found by any method.', flush=True)
        return None

    def _direct_download(self, url, folder, referer=None):
        """Raw streamed download of a direct media URL (final fallback)."""
        try:
            name = os.path.basename(urlparse(url).path) or 'video.mp4'
            name = re.sub(r'[^a-zA-Z0-9._-]', '_', name)[:120]
            stem, ext = os.path.splitext(name)
            ext = ext.lstrip('.') or 'mp4'
            dest = folder / f'{self._unique_stem(folder, stem)}.{ext}'
            headers = {'User-Agent': USER_AGENT}
            if referer:
                headers['Referer'] = referer
            print(f'   [direct] streaming: {url}', flush=True)
            req = Request(url, headers=headers)
            with urlopen(req, timeout=30) as resp, open(dest, 'wb') as out:
                total = int(resp.headers.get('Content-Length') or 0)
                got = 0
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    got += len(chunk)
                    if total:
                        print(f'\r   [download] {got/total*100:5.1f}% of {total/1048576:.1f}MiB', end='', flush=True)
            print('\n   [done] direct download finished!', flush=True)
            return str(dest)
        except Exception as e:
            print(f'   [direct] failed: {e}', flush=True)
            return None

    # ── progress ─────────────────────────────────────────────────────────
    def _progress_hook(self, d):
        status = d.get('status')
        if status == 'downloading':
            done = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            if total:
                print(f"\r   [download] {done/total*100:5.1f}% of {total/1048576:.1f}MiB "
                      f"at {d.get('_speed_str', '').strip()} ETA {d.get('_eta_str', '').strip()}",
                      end='', flush=True)
        elif status == 'finished':
            self.last_file = d.get('filename') or self.last_file
            print('\n   [done] download finished!', flush=True)
        elif status == 'error':
            print(f"\n   [error] {d.get('error', 'unknown')}", flush=True)

    # ── batch entry points ───────────────────────────────────────────────
    def download_list(self, urls):
        for i, url in enumerate(urls, 1):
            folder = self.base_dir / self.get_folder_name(url)
            print(f'\n[{i}/{len(urls)}] Processing: {url}', flush=True)
            print(f'   -> Saving to: {folder.name}/', flush=True)
            self.download(url, folder)


# ════════════════════════════════════════════════════════════════════════
#  CLI
# ════════════════════════════════════════════════════════════════════════

def run_single(args):
    """Single-URL mode used by the Node server. Emits `RESULT_FILE: <path>`."""
    dl = UniversalVideoDownloader(base_dir=args.out_dir or '.')
    folder = Path(args.out_dir) if args.out_dir else Path('.')
    print(f'[1/1] Processing: {args.url}', flush=True)
    result = dl.download(args.url, folder, out_tmpl=args.out_tmpl)
    if result and os.path.exists(result):
        print(f'RESULT_FILE: {os.path.abspath(result)}', flush=True)
        sys.exit(0)
    print('RESULT_NONE', flush=True)
    sys.exit(2)


def run_interactive():
    dl = UniversalVideoDownloader()
    print('Universal Video Downloader — Extensive Edition', flush=True)
    print('=' * 75, flush=True)
    print("\nPaste your URLs (one per line). Type 'done' when finished:\n", flush=True)
    urls = []
    while True:
        try:
            line = input().strip()
        except EOFError:
            break
        if line.lower() == 'done':
            break
        if line and line.startswith(('http://', 'https://')):
            urls.append(line)
    if not urls:
        print('No URLs provided.', flush=True)
        return
    print(f'\nStarting download of {len(urls)} item(s)...\n', flush=True)
    dl.download_list(urls)
    print('\nAll downloads completed!', flush=True)


def main():
    parser = argparse.ArgumentParser(description='Universal video downloader / page scraper')
    parser.add_argument('--url', help='Single URL to download (server mode)')
    parser.add_argument('--out-dir', help='Output directory for --url mode')
    parser.add_argument('--out-tmpl', help='yt-dlp output template (default: %%(title)s.%%(ext)s)')
    args = parser.parse_args()

    if args.url:
        run_single(args)
    else:
        run_interactive()


if __name__ == '__main__':
    main()
