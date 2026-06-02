import os
import re
import sys
from pathlib import Path

# Force UTF-8 stdout so the server process can always decode the output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import yt_dlp

class UniversalVideoDownloader:
    def __init__(self, base_dir="video_downloads"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(exist_ok=True)
        
        # Base configuration
        self.default_opts = {
            'quiet': False,
            'no_warnings': False,
            'progress_hooks': [self._progress_hook],
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
            },
            'restrictfilenames': True,
            'windowsfilenames': True,
            'overwrites': False,
            'ignoreerrors': True,
            'noplaylist': False,
            'writethumbnail': True,
            'writeinfojson': True,
            'writesubtitles': True,
            'embedthumbnail': True,
            'embedmetadata': True,
            'concurrent_fragment_downloads': 4,   # Balanced default
        }
    
    def get_site_specific_opts(self, url: str) -> dict:
        """Extensive site-specific configurations"""
        url_lower = url.lower()
        opts = self.default_opts.copy()
        
        # ==================== ADULT SITES ====================
        
        if 'pornhub.com' in url_lower:
            opts.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'noplaylist': False,
                'impersonate': 'chrome',           # Often fixes Pornhub blocks
                'prefer_free_formats': True,
                'playlist_items': '1-1000',
                'sleep_interval': 2,
            })
            
        elif 'xhamster.com' in url_lower:
            opts.update({
                'format': 'bestvideo+bestaudio/best',
                'noplaylist': False,
                'concurrent_fragment_downloads': 6,
            })
            
        elif 'xvideos.com' in url_lower or 'xvideos.red' in url_lower:
            opts.update({
                'format': 'best[ext=mp4]/best',
                'http_headers': {
                    **self.default_opts['http_headers'],
                    'Referer': 'https://www.xvideos.com/',
                },
                'concurrent_fragment_downloads': 5,
            })
            
        elif 'spankbang.com' in url_lower:
            opts.update({
                'format': 'bestvideo+bestaudio/best',
                'concurrent_fragment_downloads': 8,
                'sleep_interval': 1,
            })
            
        elif any(site in url_lower for site in ['eporner.com', 'porntrex.com']):
            opts.update({
                'format': 'bestvideo+bestaudio/best[ext=mp4]/best',
                'concurrent_fragment_downloads': 6,
            })
            
        elif any(site in url_lower for site in ['redtube.com', 'youporn.com', 'tube8.com']):
            opts.update({
                'format': 'bestvideo+bestaudio/best',
            })
            
        # ==================== GENERAL / SOCIAL SITES ====================
        
        elif any(site in url_lower for site in ['youtube.com', 'youtu.be']):
            opts.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-US'],
                'impersonate': 'chrome',
            })
            
        elif 'x.com' in url_lower or 'twitter.com' in url_lower:
            opts.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                'extractor_args': {'twitter': {'api': 'graphql'}},
                'impersonate': 'chrome',
            })
            
        elif 'instagram.com' in url_lower:
            opts.update({
                'format': 'bestvideo+bestaudio/best',
                'impersonate': 'chrome',
            })
            
        elif 'tiktok.com' in url_lower:
            opts.update({
                'format': 'best',
                'impersonate': 'chrome',
            })
            
        elif 'reddit.com' in url_lower:
            opts.update({
                'format': 'bestvideo+bestaudio/best',
            })
            
        # ==================== OTHER ADULT SITES ====================
        
        elif any(site in url_lower for site in ['xnxx.com', 'xnxxtv.com']):
            opts.update({
                'format': 'best[ext=mp4]/best',
            })
            
        elif 'hqporner.com' in url_lower:
            opts.update({
                'format': 'bestvideo+bestaudio/best',
                'concurrent_fragment_downloads': 6,
            })
            
        # Fallback for other adult tubes
        elif any(site in url_lower for site in ['beeg', 'daftsex', 'veporn', 'pornhd', 'thumbzilla']):
            opts['format'] = 'bestvideo+bestaudio/best[ext=mp4]/best'
        
        return opts
    
    def get_folder_name(self, url):
        """Improved folder naming"""
        try:
            url_lower = url.lower()
            
            
            # General case
            domain_match = re.search(r'https?://(?:www\.)?([^/]+)', url)
            domain = domain_match.group(1).lower() if domain_match else "misc"
            domain = re.sub(r'\.(com|net|org|tv|me|xxx)$', '', domain)
            domain = domain.replace('www.', '')
            
            path = url.split(domain)[-1]
            slug_match = re.search(r'/([^/]{5,60}?)(?:[/?#]|$)', path)
            slug = slug_match.group(1) if slug_match else ""
            slug = re.sub(r'[^a-zA-Z0-9._-]', '_', slug)
            
            if slug and len(slug) < 45:
                return f"{domain}_{slug}".strip('_')
            return domain.strip('_')
            
        except:
            return "misc"
    
    def download_list(self, urls):
        for i, url in enumerate(urls, 1):
            folder_name = self.get_folder_name(url)
            print(f"\n[{i}/{len(urls)}] Processing: {url}", flush=True)
            print(f"   -> Saving to: {folder_name}/", flush=True)
            self.download_single(url, folder_name)
    
    _COLLISION_EXTS = ('mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v')

    def _unique_stem(self, folder_path: Path, stem: str) -> str:
        """Return a stem (no extension) that doesn't collide with existing files."""
        def exists(s):
            return any((folder_path / f"{s}.{e}").exists() for e in self._COLLISION_EXTS)
        if not exists(stem):
            return stem
        n = 1
        while exists(f"{stem}_{n}"):
            n += 1
        return f"{stem}_{n}"

    def download_single(self, url, folder_name):
        folder_path = self.base_dir / folder_name
        folder_path.mkdir(exist_ok=True)

        ydl_opts = self.get_site_specific_opts(url)

        # ── Pre-resolve a unique filename to avoid silent overwrites ──────
        outtmpl = str(folder_path / '%(title)s.%(ext)s')
        try:
            info_opts = {**ydl_opts, 'quiet': True, 'no_warnings': True}
            with yt_dlp.YoutubeDL(info_opts) as probe:
                info = probe.extract_info(url, download=False)
            if info:
                raw = probe.prepare_filename(info)  # sanitized full path
                stem = Path(raw).stem
                unique = self._unique_stem(folder_path, stem)
                outtmpl = str(folder_path / f"{unique}.%(ext)s")
        except Exception as e:
            print(f"   [warn] pre-check failed, using default template: {e}", flush=True)

        ydl_opts['outtmpl'] = outtmpl

        try:
            print("   Starting download...", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
        except Exception as e:
            print(f"   [error] {e}", flush=True)
    
    def _progress_hook(self, d):
        if d['status'] == 'downloading':
            downloaded = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            if total > 0:
                percent = downloaded / total * 100
                print(f"   Progress: {percent:6.1f}% | "
                      f"{downloaded/1024/1024:7.1f}MB / {total/1024/1024:7.1f}MB", end='\r')
        elif d['status'] == 'finished':
            print("\n   [done] Download finished!", flush=True)
        elif d['status'] == 'error':
            print(f"\n   [error] {d.get('error', 'Unknown error')}", flush=True)


# ====================== USAGE ======================

def main():
    downloader = UniversalVideoDownloader()

    print("Universal Video Downloader - Extensive Edition", flush=True)
    print("=" * 75, flush=True)
    print("\nPaste your URLs (one per line). Type 'done' when finished:\n", flush=True)
    
    urls = []
    while True:
        try:
            line = input().strip()
            if line.lower() == 'done':
                break
            if line and line.startswith(('http://', 'https://')):
                urls.append(line)
        except EOFError:
            break
    
    if not urls:
        print("No URLs provided.")
        return
    
    print(f"\nStarting download of {len(urls)} item(s)...\n", flush=True)
    downloader.download_list(urls)
    print("\nAll downloads completed!", flush=True)


if __name__ == "__main__":
    try:
        import yt_dlp
    except ImportError:
        print("Installing yt-dlp...")
        os.system("pip install -U yt-dlp")
        print("Please restart the script.")
        sys.exit(1)
    
    main()