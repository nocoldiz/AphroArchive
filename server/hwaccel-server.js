'use strict';
// ═══════════════════════════════════════════════════════════════════
//  hwaccel-server.js — detect a working hardware HEVC/H.265 encoder
//  Probes NVENC / QSV / AMF / VAAPI / VideoToolbox by actually running a
//  1-frame test encode (listing an encoder != it initialising on this box),
//  then hands back the ffmpeg args to use it. Falls back to libx265 (CPU).
// ═══════════════════════════════════════════════════════════════════

const { execFile } = require('child_process');
const { FFMPEG_BIN } = require('./config-server');

// Software fallback — the original CPU path (CRF 28, medium preset).
const CPU_HEVC = {
  name: 'libx265 (CPU)',
  encoder: 'libx265',
  hardware: false,
  inputArgs: [],
  codecArgs: ['-c:v', 'libx265', '-crf', '28', '-preset', 'medium'],
};

// Candidate hardware encoders in preference order. `codecArgs` targets a
// constant-quality mode roughly matching x265 CRF 28. VAAPI needs the frames
// uploaded to the GPU via a filter, and a device set before the input.
const CANDIDATES = [
  {
    name: 'NVENC (NVIDIA)',
    encoder: 'hevc_nvenc',
    hardware: true,
    inputArgs: [],
    codecArgs: ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '28', '-b:v', '0'],
  },
  {
    name: 'QSV (Intel QuickSync)',
    encoder: 'hevc_qsv',
    hardware: true,
    inputArgs: [],
    codecArgs: ['-c:v', 'hevc_qsv', '-preset', 'medium', '-global_quality', '28'],
  },
  {
    name: 'AMF (AMD)',
    encoder: 'hevc_amf',
    hardware: true,
    inputArgs: [],
    codecArgs: ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '28'],
  },
  {
    name: 'VAAPI',
    encoder: 'hevc_vaapi',
    hardware: true,
    inputArgs: ['-vaapi_device', '/dev/dri/renderD128'],
    codecArgs: ['-vf', 'format=nv12,hwupload', '-c:v', 'hevc_vaapi', '-qp', '28'],
  },
  {
    name: 'VideoToolbox (Apple)',
    encoder: 'hevc_videotoolbox',
    hardware: true,
    inputArgs: [],
    codecArgs: ['-c:v', 'hevc_videotoolbox', '-q:v', '55'],
  },
];

// Run a tiny synthetic encode to confirm the encoder actually initialises on
// this machine (correct GPU/driver present). Resolves true on exit code 0.
function _probe(cand) {
  return new Promise(resolve => {
    const args = [
      '-hide_banner', '-v', 'error',
      ...cand.inputArgs,
      '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=5:d=0.2',
      ...cand.codecArgs,
      '-frames:v', '2',
      '-f', 'null', '-',
    ];
    execFile(FFMPEG_BIN, args, { timeout: 15000 }, err => resolve(!err));
  });
}

let _cached = null; // Promise<encoder descriptor>, memoised for the process lifetime.

// Returns the best working HEVC encoder descriptor. Detection runs once and is
// cached; pass { force: true } to re-probe (e.g. after a driver change).
function detectHevcEncoder(opts = {}) {
  if (_cached && !opts.force) return _cached;
  _cached = (async () => {
    for (const cand of CANDIDATES) {
      if (await _probe(cand)) {
        console.log(`[hwaccel] Using hardware HEVC encoder: ${cand.name} (${cand.encoder})`);
        return cand;
      }
    }
    console.log('[hwaccel] No hardware HEVC encoder available — falling back to libx265 (CPU)');
    return CPU_HEVC;
  })();
  return _cached;
}

module.exports = { detectHevcEncoder, CPU_HEVC };
