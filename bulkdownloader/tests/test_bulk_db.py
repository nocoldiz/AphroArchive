"""Tests for the unified JSON database (bulk_db) shared by the console + GUI.

Run from the bulkdownloader/ folder:  python -m pytest tests/ -q
"""

import bulk_db


# ── norm_key / dedup identity ─────────────────────────────────────────

def test_norm_key_strips_tracking_www_and_trailing_slash():
    a = bulk_db.norm_key('https://www.x.com/user/status/123/?utm_source=foo&si=bar')
    b = bulk_db.norm_key('https://x.com/user/status/123')
    assert a == b


def test_norm_key_keeps_meaningful_query():
    a = bulk_db.norm_key('https://site.com/watch?v=abc')
    b = bulk_db.norm_key('https://site.com/watch?v=xyz')
    assert a != b


def test_is_http():
    assert bulk_db.is_http('https://x.com')
    assert bulk_db.is_http('http://x.com')
    assert not bulk_db.is_http('ftp://x.com')
    assert not bulk_db.is_http('')
    assert not bulk_db.is_http(None)


# ── queue add + dedup ─────────────────────────────────────────────────

def test_add_to_queue_dedups_same_link_in_every_step():
    data = bulk_db.blank()
    added1 = bulk_db.add_to_queue(data, ['https://x.com/a/status/1'])
    # same link with tracking noise + www → must be treated as a duplicate
    added2 = bulk_db.add_to_queue(data, ['https://www.x.com/a/status/1?utm_source=x'])
    assert added1 == ['https://x.com/a/status/1']
    assert added2 == []
    assert len(data['queue']) == 1


def test_add_to_queue_at_top_ordering_and_source():
    data = bulk_db.blank()
    bulk_db.add_to_queue(data, ['https://x.com/1'], source='paste')
    bulk_db.add_to_queue(data, ['https://x.com/2'], source='scrape', at_top=True)
    assert [it['url'] for it in data['queue']] == ['https://x.com/2', 'https://x.com/1']
    assert data['queue'][0]['source'] == 'scrape'


def test_add_to_queue_skips_already_downloaded(tmp_path):
    data = bulk_db.blank()
    f = tmp_path / 'v.mp4'
    f.write_text('x')
    bulk_db.mark_downloaded(data, 'https://x.com/done', str(f))
    added = bulk_db.add_to_queue(data, ['https://x.com/done'])
    assert added == []
    assert data['queue'] == []


def test_redownload_allowed_when_file_missing(tmp_path):
    data = bulk_db.blank()
    missing = tmp_path / 'gone.mp4'
    bulk_db.mark_downloaded(data, 'https://x.com/gone', str(missing))
    assert not bulk_db.is_downloaded(data, 'https://x.com/gone')
    added = bulk_db.add_to_queue(data, ['https://x.com/gone'])
    assert added == ['https://x.com/gone']


# ── mark_downloaded mirroring ─────────────────────────────────────────

def test_mark_downloaded_updates_queue_and_bookmark(tmp_path):
    data = bulk_db.blank()
    bulk_db.add_to_queue(data, ['https://x.com/v/status/9'])
    bulk_db.add_bookmarks(data, ['https://x.com/v/status/9'], source='x.com')
    f = tmp_path / 'v.mp4'
    f.write_text('x')
    bulk_db.mark_downloaded(data, 'https://x.com/v/status/9', str(f))
    assert data['queue'][0]['status'] == bulk_db.ST_DONE
    assert data['queue'][0]['file'] == str(f)
    assert data['bookmarks'][0]['downloaded'] is True


# ── bookmarks ─────────────────────────────────────────────────────────

def test_add_bookmarks_dedups_strings_and_dicts():
    data = bulk_db.blank()
    a = bulk_db.add_bookmarks(data, ['https://x.com/b/status/1'], source='likes')
    b = bulk_db.add_bookmarks(
        data, [{'url': 'https://www.x.com/b/status/1?si=z', 'title': 'dup'}], source='likes')
    assert a == ['https://x.com/b/status/1']
    assert b == []
    assert len(data['bookmarks']) == 1


def test_pending_bookmark_urls_excludes_downloaded_and_queued(tmp_path):
    data = bulk_db.blank()
    bulk_db.add_bookmarks(data, ['https://x.com/1', 'https://x.com/2', 'https://x.com/3'])
    # #1 downloaded, #2 already queued → only #3 is pending
    f = tmp_path / 'a.mp4'
    f.write_text('x')
    bulk_db.mark_downloaded(data, 'https://x.com/1', str(f))
    bulk_db.add_to_queue(data, ['https://x.com/2'])
    pending = bulk_db.pending_bookmark_urls(data)
    assert pending == ['https://x.com/3']


# ── txt ingest: feeds queue, never empties txt, dedups across repeats ──

def test_ingest_links_txt_keeps_file_and_dedups(tmp_path):
    txt = tmp_path / 'links_to_download.txt'
    txt.write_text('https://x.com/1\nhttps://x.com/2\nhttps://x.com/1\n', encoding='utf-8')
    data = bulk_db.blank()

    added1 = bulk_db.ingest_links_txt(data, txt)
    assert sorted(added1) == ['https://x.com/1', 'https://x.com/2']
    assert len(data['queue']) == 2

    # second ingest adds nothing new (dedup) ...
    added2 = bulk_db.ingest_links_txt(data, txt)
    assert added2 == []
    assert len(data['queue']) == 2

    # ... and the txt file is left fully intact (never emptied)
    assert txt.read_text(encoding='utf-8') == 'https://x.com/1\nhttps://x.com/2\nhttps://x.com/1\n'


def test_dedup_collapses_duplicates():
    data = bulk_db.blank()
    data['queue'] = [
        {'url': 'https://x.com/1'},
        {'url': 'https://www.x.com/1?utm_source=a'},
        {'url': 'https://x.com/2'},
    ]
    data['bookmarks'] = [{'url': 'https://x.com/9'}, {'url': 'https://x.com/9/'}]
    q_removed, b_removed = bulk_db.dedup(data)
    assert q_removed == 1 and b_removed == 1
    assert len(data['queue']) == 2 and len(data['bookmarks']) == 1


# ── persistence round-trip + resilience ───────────────────────────────

def test_save_load_roundtrip(tmp_path):
    p = tmp_path / 'db.json'
    data = bulk_db.blank()
    bulk_db.add_to_queue(data, ['https://x.com/1'])
    bulk_db.add_bookmarks(data, ['https://x.com/2'])
    assert bulk_db.save(data, p)
    again = bulk_db.load(p)
    assert again['queue'][0]['url'] == 'https://x.com/1'
    assert again['bookmarks'][0]['url'] == 'https://x.com/2'


def test_load_missing_and_corrupt(tmp_path):
    assert bulk_db.load(tmp_path / 'nope.json') == bulk_db.blank()
    bad = tmp_path / 'bad.json'
    bad.write_text('{not json', encoding='utf-8')
    assert bulk_db.load(bad) == bulk_db.blank()
