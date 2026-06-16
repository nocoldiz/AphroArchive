'use strict';

const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR, THUMBS_DIR, FFMPEG_BIN, FFPROBE_BIN } = require('./config-server');
const { cachedScan, invalidateScanCache } = require('./videos-server');
const { toId } = require('./helpers-server');
const { genThumbs } = require('./thumbnails-server');
const { ensureAutoChaptersForVideo, hasAutoChapters } = require('./auto-chapters-server');
const { execFile } = require('child_process');

let _isProcessing = false;

// What the worker is doing right now, surfaced in the "Sync & Background Tasks"
// panel (without bumping its badge) and logged to the server terminal.
let _status = { active: false, task: '', detail: '' };

function getBackgroundWorkerStatus() {
  return _status;
}

function setStatus(task, detail = '') {
  _status = { active: !!task, task: task || '', detail };
  if (task) console.log(`Background worker: ${task}${detail ? ' — ' + detail : ''}`);
}

function apiBackgroundWorkerPoll(req, res) {
  const { json } = require('./helpers-server');
  json(res, _status);
}

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
    setStatus('Loading file index');
    const allFiles = await cachedScan();
    const files = allFiles.filter(f => !f.isExternal && !f.encrypted);
    console.log(`Background worker: Found ${files.length} files.`);

    let processedCount = 0;

    for (const file of files) {
      const fp = path.join(VIDEOS_DIR, file.rel.replace(/\\/g, path.sep));
      const id = file.id;

      try {
        // 1. Check Thumbnails
        const thumbDir = path.join(THUMBS_DIR, id);
        const hasThumbs = fs.existsSync(thumbDir) && fs.readdirSync(thumbDir).some(f => f.endsWith('.jpg'));
        if (!hasThumbs) {
          setStatus('Generating thumbnails', file.rel);
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
            setStatus('Extracting subtitles', file.rel);
            await extractSubtitles(fp, targetSub);
            processedCount++;
          }
        }

        // 3. Scene Detection (auto chapters)
        if (!hasAutoChapters(id)) {
          setStatus('Scene detection', file.rel);
          const detected = await ensureAutoChaptersForVideo(id, fp);
          if (detected) {
            console.log(`Background worker: Scene detection done for ${file.rel}`);
            processedCount++;
          }
        }
      } catch (e) {
        console.error(`Background worker: Failed to process ${file.rel}:`, e.message);
      }
    }

    // 4. Scrape Actor Info
    setStatus('Checking actors for missing info');
    const { loadActors } = require('./db-server');
    const { scrapeAndSaveActorInfo } = require('./actors-server');
    const actorsList = loadActors();

    let scrapedAny = false;
    for (const actor of actorsList) {
      if (actor.age === null && !actor.nationality && !actor.imdb_page) {
        setStatus('Scraping actor info', actor.name);
        const success = await scrapeAndSaveActorInfo(actor.name);
        if (success) {
          scrapedAny = true;
          break; // Only scrape one actor per run to avoid rate limits
        }
      }
    }

    if (!scrapedAny) {
      console.log('Background worker: No actors needed scraping or scraping failed.');
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
    setStatus(null);
    _isProcessing = false;
  }
}

function startBackgroundWorker() {
  // Run every 10 minutes
  setInterval(scanAndProcess, 10 * 60 * 1000);
  // First run after a 30s delay so the page is fully usable first
  setTimeout(scanAndProcess, 30000);
  console.log('Background worker started (running every 10 minutes)');
}

module.exports = { startBackgroundWorker, getBackgroundWorkerStatus, apiBackgroundWorkerPoll };
