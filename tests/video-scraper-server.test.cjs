'use strict';

/* global describe, it, expect */

const { cleanSearchQuery, searchOnlineVideoMetadata } = require('../server/video-scraper-server');

describe('cleanSearchQuery', () => {
  it('strips extensions, resolutions, codecs, and release groups', () => {
    const raw = 'Studio.Name.Performer.Girl.Title.1080p.HEVC.x265-RARBG[TGx].mp4';
    const cleaned = cleanSearchQuery(raw);
    expect(cleaned).toBe('Studio Name Performer Girl Title');
  });

  it('handles 4k, 2160p, 720p, web-dl, and dvdrip', () => {
    const raw = 'Another_Movie_2023_2160p_UHD_WEBRip.mkv';
    const cleaned = cleanSearchQuery(raw);
    expect(cleaned).toBe('Another Movie 2023');
  });

  it('preserves core names and clean spacing', () => {
    const raw = '   Angela White - Deep Talk (1080p)   ';
    const cleaned = cleanSearchQuery(raw);
    expect(cleaned).toBe('Angela White Deep Talk');
  });

  it('handles empty or null input gracefully', () => {
    expect(cleanSearchQuery('')).toBe('');
    expect(cleanSearchQuery(null)).toBe('');
  });
});

describe('searchOnlineVideoMetadata', () => {
  it('returns an empty array for empty or tiny queries', async () => {
    const res = await searchOnlineVideoMetadata('');
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });
});
