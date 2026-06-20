import os
import subprocess
import json
import argparse
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

# --- CONFIGURATION ---
SCRIPT_DIR = Path(__file__).parent
# In this project, we want to look for cache in the project's cache dir if possible
# but we'll default to a local db/ folder if not specified.
# However, the script will be called by the server which knows the paths.
DEFAULT_CACHE_FILE = SCRIPT_DIR / "cache/converted_cache.json"
DEFAULT_MAX_WORKERS = 2 

# FFmpeg settings for Maximum NVENC Compression
FFMPEG_EXE = "ffmpeg"
FFMPEG_CMD = [
    "{ffmpeg}", "-y", 
    "-hwaccel", "cuda",             
    "-i", "{input}",
    "-c:v", "hevc_nvenc",           
    "-preset", "p7",                
    "-tune", "hq",                  
    "-rc", "vbr",                   
    "-multipass", "fullres",        
    "-cq", "28",                    
    "-c:a", "copy",                 
    "-tag:v", "hvc1",               
    "{output}"
]

EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".ts"}

# Thread lock to prevent JSON corruption when writing from multiple workers
cache_lock = Lock()
CACHE_PATH = DEFAULT_CACHE_FILE

def load_cache():
    if CACHE_PATH.exists():
        try:
            with open(CACHE_PATH, "r") as f:
                return set(json.load(f))
        except Exception as e:
            print(f"Error loading cache: {e}")
    return set()

def save_to_cache(video_name):
    with cache_lock:
        try:
            processed = list(load_cache())
            if video_name not in processed:
                processed.append(video_name)
                CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
                with open(CACHE_PATH, "w") as f:
                    json.dump(processed, f, indent=4)
        except Exception as e:
            print(f"Error saving to cache: {e}")

def get_size(file_path):
    return Path(file_path).stat().st_size

def process_video(vid_path):
    """
    Compresses a single video file.
    vid_path: string or Path object.
    Returns: Path to the resulting file.
    """
    vid = Path(vid_path)
    if not vid.exists():
        print(f"  [ERROR] File not found: {vid}")
        return vid

    temp_output = vid.with_suffix(".temp_h265.mp4")
    print(f"Processing (High Compression): {vid.name}")
    
    cmd = [arg.format(ffmpeg=FFMPEG_EXE, input=str(vid), output=str(temp_output)) for arg in FFMPEG_CMD]
    
    try:
        # We use check=True to raise an exception on failure
        # We don't capture output here to allow real-time progress in console if run manually
        subprocess.run(cmd, check=True)
        
        if temp_output.exists():
            orig_size = get_size(vid)
            new_size = get_size(temp_output)
            
            # If the new file is at least 5% smaller, we keep it
            if new_size < orig_size * 0.95:
                reduction = (orig_size - new_size) / orig_size * 100
                print(f"  [SUCCESS] {vid.name}: {orig_size/1024/1024:.1f}MB -> {new_size/1024/1024:.1f}MB (-{reduction:.1f}%)")
                
                final_name = vid.with_suffix(".mp4")
                
                # If the original was already .mp4, we need to be careful with rename
                if vid == final_name:
                    vid.replace(vid.with_suffix(".original_backup"))
                    temp_output.rename(final_name)
                    vid.with_suffix(".original_backup").unlink()
                else:
                    vid.unlink() 
                    temp_output.rename(final_name)
                
                save_to_cache(final_name.name)
                return final_name
            else:
                print(f"  [SKIP] {vid.name}: No significant size benefit. Keeping original.")
                temp_output.unlink()
                save_to_cache(vid.name)
                return vid
                
    except Exception as e:
        print(f"  [ERROR] {vid.name}: {e}")
        if temp_output.exists():
            temp_output.unlink()
    return vid

def main():
    global CACHE_PATH, FFMPEG_EXE
    parser = argparse.ArgumentParser(description="Batch or single video H.265/NVENC compression.")
    parser.add_argument("directory", type=str, nargs="?", help="Directory to scan for videos.")
    parser.add_argument("-f", "--file", type=str, help="Compress a single video file.")
    parser.add_argument("-w", "--workers", type=int, default=DEFAULT_MAX_WORKERS, help="Number of parallel workers for batch mode.")
    parser.add_argument("--cache", type=str, help="Path to the cache file.")
    parser.add_argument("--ffmpeg", type=str, help="Path to the ffmpeg executable.")
    args = parser.parse_args()

    if args.cache:
        CACHE_PATH = Path(args.cache)
    if args.ffmpeg:
        FFMPEG_EXE = args.ffmpeg

    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: File {file_path} does not exist.")
            sys.exit(1)
        process_video(file_path)
        print("\n--- Single file task complete ---")
        return

    target_dir = Path(args.directory) if args.directory else SCRIPT_DIR / "videos"
    if not target_dir.exists():
        print(f"Error: Folder {target_dir} does not exist.")
        sys.exit(1)

    # Load cache and find files
    converted_cache = load_cache()
    all_files = [f for f in target_dir.rglob("*") if f.suffix.lower() in EXTENSIONS]
    
    # Filter out already processed files and temp files
    video_files = [f for f in all_files if f.name not in converted_cache and ".temp_h265" not in f.name]
    
    skipped_count = len(all_files) - len(video_files)
    if skipped_count > 0:
        print(f"Skipping {skipped_count} already processed or invalid videos.")

    if not video_files:
        print("No new videos found to compress.")
        return

    print(f"Found {len(video_files)} new videos in {target_dir}. Starting Maximum H.265 Compression with {args.workers} workers...\n")

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        executor.map(process_video, video_files)

    print("\n--- All high-compression tasks complete ---")

if __name__ == "__main__":
    main()
