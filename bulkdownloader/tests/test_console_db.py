"""Integration test: the console's db.json queue processor (run_from_db).

Mocks the actual download so no network/yt-dlp is needed, and verifies:
* links_to_download.txt is fed into db.json and is NOT emptied,
* successful downloads are recorded in the downloaded registry,
* the queue item flips to 'done'.
"""

import sys
import types
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def console(tmp_path, monkeypatch):
    # Point the shared db at a temp file BEFORE importing the modules.
    db_file = tmp_path / 'db.json'
    monkeypatch.setenv('BULK_DB_FILE', str(db_file))
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    bulk_db = importlib.import_module('bulk_db')
    importlib.reload(bulk_db)  # pick up the env var
    try:
        bd = importlib.import_module('bulkdownloader')
    except Exception as e:               # yt-dlp etc. unavailable in this env
        pytest.skip(f'bulkdownloader import unavailable: {e}')
    return bd, bulk_db, db_file


def test_run_from_db_feeds_txt_keeps_it_and_records_downloads(console, tmp_path, monkeypatch):
    bd, bulk_db, db_file = console

    # a links file with a duplicate (must be deduped, file kept verbatim)
    txt = tmp_path / 'links_to_download.txt'
    txt_body = 'https://x.com/a\nhttps://x.com/b\nhttps://x.com/a\n'
    txt.write_text(txt_body, encoding='utf-8')

    out = tmp_path / 'out'
    out.mkdir()

    # Fake downloader: writes a file and returns its path for every URL.
    produced = {}

    class FakeDL:
        def __init__(self, base_dir=None):
            self.base_dir = base_dir

        def download(self, url, folder, **kw):
            name = url.rstrip('/').split('/')[-1] + '.mp4'
            p = Path(folder) / name
            p.write_text('video')
            produced[url] = str(p)
            return str(p)

    monkeypatch.setattr(bd, 'UniversalVideoDownloader', FakeDL)

    args = types.SimpleNamespace(links_file=str(txt), out_dir=str(out), from_db=True,
                                 from_links=False, legacy_links=False, url=None)

    with pytest.raises(SystemExit) as exc:
        bd.run_from_db(args)
    assert exc.value.code == 0          # all succeeded

    # txt file is left fully intact (input only, never emptied)
    assert txt.read_text(encoding='utf-8') == txt_body

    data = bulk_db.load(db_file)
    urls = {it['url'] for it in data['queue']}
    assert urls == {'https://x.com/a', 'https://x.com/b'}          # deduped
    assert all(it['status'] == bulk_db.ST_DONE for it in data['queue'])
    assert bulk_db.is_downloaded(data, 'https://x.com/a')
    assert bulk_db.is_downloaded(data, 'https://x.com/b')
