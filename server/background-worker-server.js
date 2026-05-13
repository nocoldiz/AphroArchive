'use strict';

const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR, THUMBS_DIR, FFMPEG_BIN, FFPROBE_BIN } = require('./config-server');
const { scan, invalidateScanCache } = require('./videos-server');
const { toId } = require('./helpers-server');
const { genThumbs } = require('./thumbnails-server');
const { execFile } = require('child_process');

let _isProcessing = false;

function ffprobeSubtitles(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, ['-v', 'quiet', '-print_format', 'json', '-show_streams', fp],
      { timeout: 15000 },
      (err, out) => {
        if (err) return resolve(false);
        try {
          const data = JSON.parse(out);
          const hasSub = data.streams.some(s => s.codec_type === 'subtitle');
          resolve(hasSub);
        } catch { resolve(false); }
      });
  });
}

function extractSubtitles(fp, targetSub) {
  return new Promise(resolve => {
    execFile(FFMPEG_BIN, ['-i', fp, '-map', '0:s:0', '-y', targetSub],
      { timeout: 30000 },
      err => {
        if (err) {
          console.error('Background worker: Failed to extract subtitles for', fp, err);
          resolve(false);
        } else {
          console.log('Background worker: Extracted subtitles for', fp);
          resolve(true);
        }
      });
  });
}

async function scanAndProcess() {
  if (_isProcessing) return;
  _isProcessing = true;

  try {
    console.log('Background worker: Scanning files...');
    const files = await scan(VIDEOS_DIR);
    console.log(`Background worker: Found ${files.length} files.`);

    let processedCount = 0;

    for (const file of files) {
      const fp = path.join(VIDEOS_DIR, file);
      const id = toId(file);

      // 1. Check Thumbnails
      const thumbDir = path.join(THUMBS_DIR, id);
      const hasThumbs = fs.existsSync(thumbDir) && fs.readdirSync(thumbDir).some(f => f.endsWith('.jpg'));
      if (!hasThumbs) {
        console.log(`Background worker: Generating thumbnails for ${file}`);
        await genThumbs(id, fp);
        processedCount++;
      }

      // 2. Check Subtitles
      const dir = path.dirname(fp);
      const base = path.basename(fp, path.extname(fp));
      const targetSub = path.join(dir, `${base}.en.vtt`);
      
      if (!fs.existsSync(targetSub)) {
        const hasEmbeddedSubs = await ffprobeSubtitles(fp);
        if (hasEmbeddedSubs) {
          console.log(`Background worker: Extracting subtitles for ${file}`);
          await extractSubtitles(fp, targetSub);
          processedCount++;
        }
      }
    }

    if (processedCount > 0) {
      console.log(`Background worker: Processed ${processedCount} files. Invalidating cache.`);
      invalidateScanCache();
    } else {
      console.log('Background worker: No new files needed processing.');
    }
  } catch (e) {
    console.error('Background worker error:', e);
  } finally {
    _isProcessing = false;
  }
}

function startBackgroundWorker() {
  // Run every 5 minutes
  setInterval(scanAndProcess, 5 * 60 * 1000);
  // Run once at start after a short delay
  setTimeout(scanAndProcess, 10000);
  console.log('Background worker started (running every 5 minutes)');
}

module.exports = { startBackgroundWorker };
