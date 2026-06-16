#!/usr/bin/env python3
"""
AphroArchive Recategorizer — standalone CLI (no server needed)
Scans the videos folder, derives categories from subfolders, loads category
tags from SQLite (if found), dry-runs the recategorization plan, then
physically moves files on confirmation.

Usage:
  python categorizer.py <videos_dir>
  python categorizer.py <videos_dir> --db <path/to/aphroarchive_default.db>
  python categorizer.py <videos_dir> --profile MyProfile
"""

import sys
import os
import re
import shutil
import argparse
from pathlib import Path
from typing import Optional

try:
    import sqlite3
    HAS_SQLITE = True
except ImportError:
    HAS_SQLITE = False

VIDEO_EXTS = {
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv',
    '.webm', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg',
}

MIN_SCORE = 50  # minimum term_score to accept a folder match


# ── Matching logic (mirrors CategorizerView.tsx) ──────────────────────────────

def levenshtein(a: str, b: str) -> int:
    m, n = len(a), len(b)
    if not m: return n
    if not n: return m
    row = list(range(n + 1))
    for i in range(1, m + 1):
        diag = row[0]
        row[0] = i
        for j in range(1, n + 1):
            tmp    = row[j]
            cost   = 0 if a[i - 1] == b[j - 1] else 1
            row[j] = min(row[j] + 1, row[j - 1] + 1, diag + cost)
            diag   = tmp
    return row[n]


def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r'[._\-/\\]+', ' ', s)
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def term_score(words: list, joined: str, term: str) -> int:
    if not term:
        return 0
    if ' ' in term:
        return 100 if term in joined else 0
    best = 0
    for w in words:
        if w == term:
            return 100
        if len(term) >= 3 and term in w:
            best = max(best, 78)
        elif len(w) >= 4 and w in term:
            best = max(best, 58)
        elif len(term) >= 4 and len(w) >= 4:
            ratio = 1 - levenshtein(w, term) / max(len(w), len(term))
            if ratio >= 0.8:
                best = max(best, round(ratio * 68))
    return best


def best_folder(folder_terms: list, name: str) -> Optional[dict]:
    """Return {'path': ..., 'matched': ..., 'score': ...} or None."""
    joined = normalize(re.sub(r'\.[^.]+$', '', name))
    words  = [w for w in joined.split() if w]
    if not words:
        return None
    best_path, best_total, best_term = '', 0, ''
    for f in folder_terms:
        f_score, f_term = 0, ''
        for t in f['terms']:
            s = term_score(words, joined, t)
            if s > f_score:
                f_score, f_term = s, t
        if f_score < MIN_SCORE:
            continue
        total = f_score + f['depth'] * 4
        if total > best_total:
            best_total, best_path, best_term = total, f['path'], f_term
    return {'path': best_path, 'matched': best_term, 'score': best_total} if best_path else None


# ── Filesystem scanning ───────────────────────────────────────────────────────

def scan_categories(videos_dir: Path) -> list:
    """Return list of {path, depth} for every subdirectory (no root)."""
    cats = []
    for root, dirs, _ in os.walk(videos_dir):
        dirs.sort()
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        rel = Path(root).relative_to(videos_dir)
        if rel == Path('.'):
            continue
        cats.append({
            'path':  rel.as_posix(),
            'depth': len(rel.parts),
        })
    return cats


def scan_videos(videos_dir: Path) -> list:
    """Return list of {name, abs_path, cat_path} for every video file."""
    videos = []
    for root, dirs, files in os.walk(videos_dir):
        dirs.sort()
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in sorted(files):
            if Path(fname).suffix.lower() not in VIDEO_EXTS:
                continue
            abs_path = Path(root) / fname
            rel_dir  = Path(root).relative_to(videos_dir)
            cat_path = rel_dir.as_posix() if rel_dir != Path('.') else ''
            videos.append({'name': fname, 'abs_path': abs_path, 'cat_path': cat_path})
    return videos


# ── SQLite category tags ──────────────────────────────────────────────────────

def load_cat_tags(db_path: Path) -> dict:
    """Return {category_name_lower: [tag, ...]} from category_tags table."""
    if not HAS_SQLITE or not db_path.exists():
        return {}
    try:
        con = sqlite3.connect(str(db_path))
        rows = con.execute('SELECT category_name, tag FROM category_tags').fetchall()
        con.close()
        result: dict = {}
        for cat_name, tag in rows:
            result.setdefault(cat_name.lower(), []).append(normalize(tag))
        return result
    except Exception as e:
        print(f'  (warning: could not read category tags from DB: {e})')
        return {}


def find_db(videos_dir: Path, profile: str) -> Optional[Path]:
    """Auto-locate the AphroArchive SQLite database."""
    import json
    name = f'aphroarchive_{profile}.db'

    def _check_root(root: Path) -> Optional[Path]:
        # Check paths.json for a custom dbDir
        paths_file = root / 'paths.json'
        if paths_file.exists():
            try:
                cfg = json.loads(paths_file.read_text())
                if cfg.get('dbDir'):
                    db = Path(cfg['dbDir']) / name
                    if db.exists():
                        return db
            except Exception:
                pass
        # Default: {root}/db/
        db = root / 'db' / name
        if db.exists():
            return db
        return None

    # Walk up from videos_dir to find the project root (has server.js)
    candidate = videos_dir
    for _ in range(6):
        candidate = candidate.parent
        if (candidate / 'server.js').exists():
            hit = _check_root(candidate)
            if hit:
                return hit
            break  # found root but no db — stop walking
        hit = _check_root(candidate)
        if hit:
            return hit

    # Fallback: script is in utils/, parent is project root
    script_root = Path(__file__).resolve().parent.parent
    return _check_root(script_root)


# ── Build & print plan ────────────────────────────────────────────────────────

def build_folder_terms(cats: list, cat_tags: dict) -> list:
    result = []
    for c in cats:
        leaf  = c['path'].split('/')[-1]
        tags  = cat_tags.get(leaf.lower(), []) or cat_tags.get(c['path'].lower(), [])
        terms = [normalize(leaf)] + list(tags)
        terms = [t for t in terms if t]
        result.append({'path': c['path'], 'depth': c['depth'], 'terms': terms})
    return result


def build_plan(videos: list, folder_terms: list) -> list:
    moves = []
    for v in videos:
        hit = best_folder(folder_terms, v['name'])
        if not hit or hit['path'] == v['cat_path']:
            continue
        moves.append({**v, 'to_path': hit['path'], 'matched': hit['matched']})
    return moves


def print_plan(moves: list):
    if not moves:
        print('No moves needed — all videos are already in their best-matching folder.')
        return

    uncategorized = [m for m in moves if not m['cat_path']]
    recategorized = [m for m in moves if m['cat_path']]

    def _print_section(section_moves: list, header: str):
        if not section_moves:
            return
        by_dest: dict = {}
        for m in section_moves:
            by_dest.setdefault(m['to_path'], []).append(m)
        print(f'\n  {header} ({len(section_moves)})\n')
        for _, ms in sorted(by_dest.items(), key=lambda x: x[0]):
            print(f'  → {ms[0]["to_path"]}')
            for m in ms:
                short = re.sub(r'\.[^.]+$', '', m['name'])
                if len(short) > 58:
                    short = short[:55] + '…'
                from_label = m['cat_path'] or 'root'
                print(f'      {short}')
                print(f'        from: {from_label}   matched: "{m["matched"]}"  score: {m.get("score", "?")}')
            print()

    print(f'\n{"─"*64}')
    print(f'  {len(moves)} video(s) would be moved')
    _print_section(uncategorized, 'Uncategorized → folder')
    _print_section(recategorized, 'Wrong folder → correct folder')
    print('─'*64)


def apply_plan(moves: list, videos_dir: Path):
    done = failed = 0
    for m in moves:
        dest_dir = videos_dir / m['to_path']
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / m['name']
        # Avoid collision
        if dest.exists() and dest != m['abs_path']:
            stem = dest.stem
            suffix = dest.suffix
            n = 1
            while dest.exists():
                dest = dest_dir / f'{stem}_{n}{suffix}'
                n += 1
        try:
            shutil.move(str(m['abs_path']), str(dest))
            done += 1
            print(f'  ✓  {m["name"][:60]}')
        except Exception as e:
            failed += 1
            print(f'  ✗  {m["name"][:60]}  — {e}')
    print(f'\nDone: {done} moved, {failed} failed.')


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Recategorize AphroArchive videos by folder-name matching.')
    parser.add_argument('videos_dir', nargs='?', help='Path to the videos folder (default: ../videos)')
    parser.add_argument('--db',      help='Path to the SQLite database (auto-detected if omitted)')
    parser.add_argument('--profile', default=None, help='Profile name for auto-detecting the DB')
    args = parser.parse_args()

    default_videos = Path(__file__).resolve().parent.parent / 'videos'
    videos_dir = Path(args.videos_dir).resolve() if args.videos_dir else default_videos
    if not videos_dir.is_dir():
        print(f'Error: {videos_dir} is not a directory')
        sys.exit(1)

    if args.profile is None:
        try:
            profile_input = input('Profile name [default]: ').strip()
        except (EOFError, KeyboardInterrupt):
            print('\nCancelled.')
            return
        args.profile = profile_input or 'default'

    # DB for category tags
    if args.db:
        db_path = Path(args.db).resolve()
    else:
        db_path = find_db(videos_dir, args.profile)

    if db_path and db_path.exists():
        print(f'Using DB: {db_path}')
    else:
        print('No SQLite DB found — category tags will not be used.')
        db_path = None

    print(f'Scanning {videos_dir} …')
    cats     = scan_categories(videos_dir)
    videos   = scan_videos(videos_dir)
    cat_tags = load_cat_tags(db_path) if db_path else {}

    print(f'{len(videos)} videos, {len(cats)} category folders, {sum(len(v) for v in cat_tags.values())} tags loaded')

    folder_terms = build_folder_terms(cats, cat_tags)
    moves        = build_plan(videos, folder_terms)

    print_plan(moves)

    if not moves:
        return

    try:
        answer = input('Apply these moves? [y/N] ').strip().lower()
    except (EOFError, KeyboardInterrupt):
        print('\nCancelled.')
        return

    if answer != 'y':
        print('Cancelled.')
        return

    print()
    apply_plan(moves, videos_dir)


if __name__ == '__main__':
    main()
