#!/usr/bin/env python3
"""
AphroArchive Video Organizer
Scans video_downloads/ and sorts videos into main genre subfolders under videos/
based on filename keyword matching.

Usage:
    python organizer_videos.py              (scan and move files)
    python organizer_videos.py --dry-run    (preview only)
    python organizer_videos.py --source <path>  (scan custom path)
"""

import os
import re
import sys
import json
import shutil
from collections import defaultdict

PROJECT_ROOT = r'c:\github\AphroArchive'
VIDEOS_DIR = os.path.join(PROJECT_ROOT, 'videos')
VIDEO_DOWNLOADS_DIR = os.path.join(PROJECT_ROOT, 'video_downloads')

VIDEO_EXTS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts'}
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'}
PART_EXTS = {'.part', '.crdownload', '.temp', '.tmp'}

# keyword -> main genre folder mapping
KEYWORD_MAP = {
    # Orientation/Sexuality
    'gay': 'Gay', 'homosexual': 'Gay', 'male-male': 'Gay', 'bareback': 'Gay',
    'raw gay': 'Gay', 'twink': 'Gay', 'bear': 'Gay', 'daddy': 'Gay',
    'jock': 'Gay', 'otter': 'Gay', 'hairy gay': 'Gay', 'leather gay': 'Gay',
    'cub': 'Gay', 'gay orgy': 'Gay', 'gay group': 'Gay', 'gay party': 'Gay',
    'gay gangbang': 'Gay',
    'lesbian': 'Lesbian', 'girl on girl': 'Lesbian', 'scissoring': 'Lesbian',
    'tribbing': 'Lesbian',
    'bisexual': 'Bisexual', 'bi-curious': 'Bisexual', 'bi guy': 'Bisexual',
    'mmf': 'Bisexual', 'ffm': 'Bisexual',
    'trans': 'Trans', 'transgender': 'Trans', 'shemale': 'Trans',
    'transsexual': 'Trans', 'mtf': 'Trans', 'ftm': 'Trans',
    'ladyboy': 'Trans', 'crossdress': 'Trans', 'femboy': 'Trans',
    'sissy': 'Trans', 'trap': 'Trans', 'futanari': 'Trans',
    'straight': 'Straight',
    
    # Activities
    'anal': 'Anal', 'anus': 'Anal', 'assfuck': 'Anal',
    'ass to mouth': 'Anal', 'atm': 'Anal',
    'double penetration': 'Anal', 'dp anal': 'Anal',
    'rimming': 'Anal', 'rimjob': 'Anal', 'anilingus': 'Anal',
    'pegging': 'Anal',
    'bareback': 'Bareback', 'raw sex': 'Bareback', 'unprotected': 'Bareback',
    'no condom': 'Bareback', 'creampie': 'Bareback',
    'chemsex': 'Bareback', 'pnp': 'Bareback', 'party and play': 'Bareback',
    'poz': 'Bareback', 'slamming': 'Bareback',
    'bdsm': 'BDSM', 'kink': 'BDSM',
    'bondage': 'Bondage', 'tied up': 'Bondage', 'shibari': 'Bondage',
    'rope': 'Bondage', 'restraint': 'Bondage',
    'bukkake': 'Bukkake', 'cum bath': 'Bukkake',
    'creampie': 'Creampie', 'internal cum': 'Creampie', 'breeding': 'Creampie',
    'cumshot': 'Cumshot', 'cum shot': 'Cumshot', 'ejaculation': 'Cumshot',
    'deepthroat': 'Deepthroat', 'facefuck': 'Deepthroat', 'throat fuck': 'Deepthroat',
    'double penetration': 'Double Penetration', 'dp': 'Double Penetration',
    'facial': 'Facial', 'cum on face': 'Facial', 'facial cumshot': 'Facial',
    'femdom': 'Femdom', 'female domination': 'Femdom', 'mistress': 'Femdom',
    'dominatrix': 'Femdom', 'findom': 'Femdom',
    'fisting': 'Fisting', 'fist': 'Fisting', 'handballing': 'Fisting',
    'gangbang': 'Gangbang',
    'handjob': 'Handjob', 'hand job': 'Handjob', 'hj': 'Handjob',
    'interracial': 'Interracial', 'bbc': 'Interracial', 'mixed': 'Interracial',
    'joi': 'JOI', 'jerk off instruction': 'JOI', 'cei': 'JOI',
    'oral': 'Oral', 'blowjob': 'Oral', 'blow job': 'Oral', 'bj': 'Oral',
    'cunnilingus': 'Oral', '69': 'Oral', 'pussy eating': 'Oral',
    'orgy': 'Orgy', 'group sex': 'Orgy', 'foursome': 'Orgy',
    'pissing': 'Pissing', 'piss': 'Pissing', 'golden shower': 'Pissing',
    'watersports': 'Pissing', 'piss play': 'Pissing',
    'solo': 'Solo', 'masturbation': 'Solo', 'solo male': 'Solo',
    'solo female': 'Solo',
    'spanking': 'Spanking', 'over the knee': 'Spanking', 'otk': 'Spanking',
    'squirting': 'Squirting', 'squirt': 'Squirting', 'female ejaculation': 'Squirting',
    'threesome': 'Threesome', 'threeway': 'Threesome', '3some': 'Threesome',
    
    # Body type
    'bbw': 'BBW', 'big beautiful': 'BBW', 'ssbbw': 'BBW', 'plump': 'BBW',
    'big ass': 'Big Ass', 'big booty': 'Big Ass', 'phat ass': 'Big Ass',
    'pawg': 'Big Ass', 'bubble butt': 'Big Ass',
    'big dick': 'Big Dick', 'big cock': 'Big Dick', 'huge cock': 'Big Dick',
    'bbc': 'Big Dick', 'monster cock': 'Big Dick', 'big dildo': 'Big Dick',
    'big tits': 'Big Tits', 'big boobs': 'Big Tits', 'busty': 'Big Tits',
    'huge tits': 'Big Tits', 'massive tits': 'Big Tits',
    'chubby': 'Chubby', 'curvy': 'Chubby', 'thick': 'Chubby',
    'ebony': 'Ebony', 'black': 'Ebony', 'dark skin': 'Ebony',
    'latina': 'Latina', 'brazilian': 'Latina', 'mexican': 'Latina',
    'colombian': 'Latina', 'spanish': 'Latina', 'cuban': 'Latina',
    'mature': 'Mature', 'cougar': 'Mature', 'older': 'Mature',
    'granny': 'Mature', 'grandma': 'Mature', 'wrinkly': 'Mature',
    'milf': 'MILF', 'step mom': 'MILF', 'stepmom': 'MILF',
    'muscle': 'Muscle', 'muscular': 'Muscle', 'bodybuilder': 'Muscle',
    'teen': 'Teen', '18yr': 'Teen', 'young': 'Teen',
    'twink': 'Twink',
    
    # Roleplay/Scenario
    'amateur': 'Amateur', 'homemade': 'Amateur', 'real couple': 'Amateur',
    'self shot': 'Amateur', 'webcam': 'Amateur', 'pov': 'Amateur',
    'asian': 'Asian', 'japanese': 'Asian', 'jav': 'Asian', 'korean': 'Asian',
    'chinese': 'Asian', 'thai': 'Asian', 'filipina': 'Asian', 'pinay': 'Asian',
    'casting': 'Casting', 'audition': 'Casting', 'casting couch': 'Casting',
    'cosplay': 'Cosplay', 'costume': 'Cosplay', 'anime cosplay': 'Cosplay',
    'crossdress': 'Crossdresser', 'cross dress': 'Crossdresser',
    'cuckold': 'Cuckold', 'cuck': 'Cuckold', 'cuckolding': 'Cuckold',
    'fantasy': 'Fantasy', 'elf': 'Fantasy', 'vampire': 'Fantasy',
    'monster': 'Fantasy', 'tentacle': 'Fantasy', 'succubus': 'Fantasy',
    'furry': 'Fantasy', 'giantess': 'Fantasy',
    'feet': 'Feet', 'foot': 'Feet', 'footjob': 'Feet', 'toe': 'Feet',
    'food': 'Fetish', 'fetish': 'Fetish',
    'hentai': 'Hentai', 'anime': 'Hentai', 'manga': 'Hentai',
    'hotwife': 'Hotwife', 'wife sharing': 'Hotwife',
    'lactation': 'Lactation', 'milking': 'Lactation', 'breast milk': 'Lactation',
    'latex': 'Latex', 'rubber': 'Latex', 'catsuit': 'Latex',
    'massage': 'Massage', 'erotic massage': 'Massage', 'nuru': 'Massage',
    'public': 'Public', 'outdoor': 'Public', 'exhibition': 'Public',
    'beach': 'Public', 'car sex': 'Public',
    'roleplay': 'Roleplay', 'role play': 'Roleplay',
    'romantic': 'Romantic', 'sensual': 'Romantic', 'lovemaking': 'Romantic',
    'rough': 'Rough', 'hardcore': 'Rough', 'violent': 'Rough',
    'choking': 'Rough', 'hair pull': 'Rough',
    'schoolgirl': 'Schoolgirl', 'school girl': 'Schoolgirl', 'uniform': 'Uniform',
    'teacher': 'Uniform', 'nurse': 'Uniform', 'babysitter': 'Uniform',
    'cheerleader': 'Uniform', 'maid': 'Uniform',
    'vintage': 'Vintage', 'classic': 'Vintage', 'retro': 'Vintage',
    '80s': 'Vintage', '90s': 'Vintage',
    
    # Source-based
    'grok': 'AI_Generated', 'midjourney': 'AI_Generated',
    'stable diffusion': 'AI_Generated', 'ai generated': 'AI_Generated',
    'sora': 'AI_Generated', 'comfyui': 'AI_Generated',
    'motherless': 'Site_Archives', 'xhamster': 'Site_Archives',
    'gayporntube': 'Site_Archives', 'boyfriendtv': 'Site_Archives',
    'xvideos': 'Site_Archives', 'pornhub': 'Site_Archives',
    'redtube': 'Site_Archives', 'youporn': 'Site_Archives',
    'spankbang': 'Site_Archives', 'duckduckgo': 'Site_Archives',
    'reddit': 'Site_Archives', 'twitter': 'Site_Archives',
    'tumblr': 'Site_Archives', 'pimpandhost': 'Site_Archives',
    'imagefap': 'Site_Archives',
}


def find_video_files(source_dir):
    """Recursively find video/image files in source_dir."""
    videos = []
    images = []
    incomplete = []
    
    if not os.path.exists(source_dir):
        print(f"  [ERROR] Source not found: {source_dir}")
        return videos, images, incomplete
    
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in files:
            fpath = os.path.join(root, fname)
            ext = os.path.splitext(fname.lower())[1]
            if ext in PART_EXTS:
                incomplete.append(fpath)
            elif ext in VIDEO_EXTS:
                videos.append(fpath)
            elif ext in IMAGE_EXTS:
                images.append(fpath)
    
    return videos, images, incomplete


def get_category(filename):
    """Score filename against keywords and return best matching folder."""
    name = os.path.splitext(os.path.basename(filename))[0].lower()
    parent = os.path.basename(os.path.dirname(filename)).lower()
    search_text = f"{name} {parent}"
    search_text = re.sub(r'[_-]+', ' ', search_text)
    search_text = re.sub(r'\s+', ' ', search_text).strip()
    
    scores = defaultdict(int)
    for keyword, folder in KEYWORD_MAP.items():
        if keyword in search_text:
            # Bonus for exact word boundary
            if re.search(r'\b' + re.escape(keyword) + r'\b', search_text):
                scores[folder] += 20
            else:
                scores[folder] += 10
    
    if not scores:
        return None
    best = sorted(scores.items(), key=lambda x: -x[1])
    return best[0][0] if best[0][1] > 0 else None


def organize_videos(dry_run=False, source_dir=None):
    if source_dir is None:
        source_dir = VIDEO_DOWNLOADS_DIR
    
    print(f"\n{'='*60}")
    print(f"  VIDEO ORGANIZER")
    print(f"  Source: {source_dir}")
    print(f"  Target: {VIDEOS_DIR}")
    print(f"  Mode:   {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"{'='*60}\n")
    
    # Scan
    print("[1/2] Scanning for files...")
    videos, images, incomplete = find_video_files(source_dir)
    print(f"  Found: {len(videos)} videos, {len(images)} images, {len(incomplete)} incomplete")
    
    # Categorize
    print("\n[2/2] Categorizing files...")
    categorized = defaultdict(list)
    uncategorized = []
    
    for fpath in videos + images:
        folder = get_category(fpath)
        if folder:
            target = os.path.join(VIDEOS_DIR, folder)
            if os.path.exists(target):
                categorized[folder].append(fpath)
            else:
                uncategorized.append((fpath, f"'{folder}' folder doesn't exist"))
        else:
            uncategorized.append((fpath, "no keyword match"))
    
    # Summary
    print(f"\n  Results:")
    for folder, files in sorted(categorized.items(), key=lambda x: -len(x[1])):
        print(f"    [{folder}] {len(files)} files")
    
    print(f"  Uncategorized: {len(uncategorized)}")
    
    # Move or dry-run
    if dry_run:
        print(f"\n  [DRY RUN] Would move {sum(len(f) for f in categorized.values())} files")
        for folder, files in sorted(categorized.items()):
            print(f"    {folder}:")
            for f in files[:3]:
                print(f"      -> {os.path.basename(f)}")
            if len(files) > 3:
                print(f"      ... (+{len(files)-3} more)")
    else:
        moved = 0
        for folder, files in categorized.items():
            target_dir = os.path.join(VIDEOS_DIR, folder)
            os.makedirs(target_dir, exist_ok=True)
            
            for fpath in files:
                try:
                    fname = os.path.basename(fpath)
                    dest = os.path.join(target_dir, fname)
                    base, ext = os.path.splitext(fname)
                    counter = 1
                    while os.path.exists(dest):
                        dest = os.path.join(target_dir, f"{base}_{counter}{ext}")
                        counter += 1
                    shutil.move(fpath, dest)
                    moved += 1
                except Exception as e:
                    print(f"    [ERROR] {os.path.basename(fpath)}: {e}")
        
        print(f"\n  Moved {moved} files into genre folders")
    
    # Show uncategorized samples
    if uncategorized:
        print(f"\n  Uncategorized samples (showing up to 10):")
        for fpath, reason in uncategorized[:10]:
            print(f"    - {os.path.basename(fpath)} ({reason})")
    
    print(f"\n{'='*60}")
    print(f"  {'DRY RUN' if dry_run else 'DONE'}")
    print(f"{'='*60}")


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    source = None
    if '--source' in sys.argv:
        idx = sys.argv.index('--source')
        if idx + 1 < len(sys.argv):
            source = sys.argv[idx + 1]
    
    organize_videos(dry_run=dry_run, source_dir=source)