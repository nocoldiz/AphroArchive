import os
import re
import sys
from pathlib import Path
import yt_dlp
from tqdm import tqdm

class MotherlessDownloader:
    def __init__(self, base_dir="motherless_downloads"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(exist_ok=True)
        
    def extract_folder_code(self, url):
        """Extract gallery code like GFCCB95E from URL"""
        match = re.search(r'motherless\.com/([^/]+)/', url)
        return match.group(1) if match else "misc"
    
    def download_list(self, urls):
        """Download multiple videos with folder organization"""
        for i, url in enumerate(urls, 1):
            folder_code = self.extract_folder_code(url)
            print(f"\n[{i}/{len(urls)}] Downloading: {url} → Folder: {folder_code}")
            self.download_single(url, folder_code)
    
    def download_single(self, url, folder_code):
        """Download single video into specific folder"""
        folder_path = self.base_dir / folder_code
        folder_path.mkdir(exist_ok=True)
        
        ydl_opts = {
            'outtmpl': str(folder_path / '%(title)s.%(ext)s'),
            'quiet': False,
            'no_warnings': False,
            'progress_hooks': [self._progress_hook],
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            # Handle duplicate filenames automatically
            'restrictfilenames': True,
            'windowsfilenames': True,
            # This helps with duplicates
            'overwrites': False,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
        except Exception as e:
            print(f"   Error: {e}")

    def _progress_hook(self, d):
        if d['status'] == 'downloading':
            downloaded = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            
            if total > 0:
                percent = downloaded / total * 100
                print(f"   Progress: {percent:6.1f}% | "
                      f"{downloaded/1024/1024:7.1f}MB / {total/1024/1024:7.1f}MB", end='\r')
        elif d['status'] == 'finished':
            print("\n   Download finished!")


# ====================== USAGE ======================

def main():
    downloader = MotherlessDownloader()
    
    print("Motherless Mass Downloader with Folder Organization")
    print("=" * 65)
    print("Paste your URLs (one per line). Type 'done' when finished:\n")
    
    urls = []
    while True:
        line = input().strip()
        if line.lower() == 'done':
            break
        if line:
            urls.append(line)
    
    if not urls:
        print("No URLs provided.")
        return
    
    print(f"\nStarting download of {len(urls)} videos...\n")
    downloader.download_list(urls)
    print("\nAll downloads completed!")


if __name__ == "__main__":
    main()