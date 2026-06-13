#!/usr/bin/env python3
"""Build a standalone executable for the Bulk Downloader GUI.

Uses PyInstaller to bundle Bulkdownloader/bulkdownloader_gui.py together
with its bulkdownloader.py backend into a single executable for the
current operating system. Output is written to dist/.

Usage:
    python build_bulkdownloader.py
"""

import os
import sys
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_DIR = PROJECT_ROOT / 'Bulkdownloader'
GUI_SCRIPT = SRC_DIR / 'bulkdownloader_gui.py'
BACKEND_SCRIPT = SRC_DIR / 'bulkdownloader.py'
DIST_DIR = PROJECT_ROOT / 'dist'


def ensure_pyinstaller():
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print('Installing PyInstaller...', flush=True)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-U', 'pyinstaller'], check=True)


def main():
    if not GUI_SCRIPT.exists() or not BACKEND_SCRIPT.exists():
        sys.exit(f'Could not find {GUI_SCRIPT} / {BACKEND_SCRIPT}')

    ensure_pyinstaller()

    data_sep = ';' if os.name == 'nt' else ':'
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--noconfirm',
        '--onefile',
        '--windowed',
        '--name', 'BulkDownloaderGUI',
        '--add-data', f'{BACKEND_SCRIPT}{data_sep}.',
        '--distpath', str(DIST_DIR),
        '--workpath', str(PROJECT_ROOT / 'build' / 'bulkdownloader'),
        '--specpath', str(PROJECT_ROOT / 'build'),
        str(GUI_SCRIPT),
    ]

    print('Running:', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)

    exe_name = 'BulkDownloaderGUI.exe' if os.name == 'nt' else 'BulkDownloaderGUI'
    print(f'\nDone. Output: {DIST_DIR / exe_name}', flush=True)
    print('Note: the target machine still needs Python + yt-dlp on PATH '
          '(used as the download backend at runtime).', flush=True)


if __name__ == '__main__':
    main()
