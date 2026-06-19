# -*- mode: python ; coding: utf-8 -*-
import sys
import shutil

# UPX corrupts/breaks binaries on macOS (dylib loading + codesigning) and is
# usually absent on macOS/Linux, which would abort the build. Only enable it on
# non-Darwin platforms when the upx executable is actually available.
USE_UPX = sys.platform != 'darwin' and shutil.which('upx') is not None

a = Analysis(
    ['bulkdownloader_gui.py'],
    pathex=[],
    binaries=[],
    datas=[('bulkdownloader.py', '.'), ('site_search.py', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='BulkDownloaderGUI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=USE_UPX,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=sys.platform == 'darwin',
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='BulkDownloaderGUI.app',
        bundle_identifier='com.aphroarchive.bulkdownloader',
    )
