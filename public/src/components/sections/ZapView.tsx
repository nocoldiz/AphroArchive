import { formatVideoTitle } from '../../utils';
import { useState, useCallback, useMemo, useRef } from 'preact/hooks';
import { isMuted, allVideos, linkVidIds, actors, folders } from '../../store';
import {
  zapLock, zapMinIv, zapMaxIv, zapRemaining, zapTotalIv, zapQueue, zapHistory,
  zapStartTime, zapFilteredPool,
  setZapMinIv, setZapMaxIv, toggleZapLock, stopZapping, openAndStopZapping,
  doZapSwitch, jumpToZapVideo, jumpToPrevZap, refillZapQueue, setZapQueueFromList,
  ZapQueueItem
} from '../../zap';
import { AdvancedPlayer } from '../UI/AdvancedPlayer';

interface ZapViewProps {
  video: any;
  videoRef: any;
  subtitles: any[];
  chapters: any[];
  language: string;
}

interface ZapChip {
  value: string;
  type: 'actor' | 'folder' | 'tag' | 'text';
}

interface Suggestion {
  value: string;
  type: ZapChip['type'];
  label: string;
}

const formatSecs = (s: number) => `${Math.max(0, Math.ceil(s))}s`;

function matchVideo(v: any, chip: ZapChip): boolean {
  switch (chip.type) {
    case 'actor':
      return (v.actors || []).some((a: string) => a.toLowerCase() === chip.value.toLowerCase());
    case 'folder': {
      const cl = chip.value.toLowerCase().replace(/\\/g, '/');
      const vp = (v.catPath || '').toLowerCase().replace(/\\/g, '/');
      return vp === cl || vp.startsWith(cl + '/') || (v.category || '').toLowerCase() === chip.value.toLowerCase();
    }
    case 'tag':
      return (v.tags || []).some((t: string) => t.toLowerCase() === chip.value.toLowerCase());
    case 'text': {
      const q = chip.value.toLowerCase();
      return (v.name || '').toLowerCase().includes(q)
        || (v.category || '').toLowerCase().includes(q)
        || (v.studio || '').toLowerCase().includes(q)
        || (v.actors || []).some((a: string) => a.toLowerCase().includes(q));
    }
  }
}

export const ZapView = ({ video, videoRef, subtitles, chapters, language }: ZapViewProps) => {
  const remaining = zapRemaining.value;
  const total = zapTotalIv.value;
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const src = video.isVault ? `/api/vault/stream/${video.id}` : `/api/stream/${video.id}`;

  const [chips, setChips] = useState<ZapChip[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [andMode, setAndMode] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const bms = linkVidIds.value;
  const allVids = allVideos.value;
  const actorList = actors.value;
  const folderList = folders.value;

  const getFilteredList = useCallback((currentChips: ZapChip[], currentAndMode: boolean) => {
    const streamable = allVids.filter(v => !v.isLink && !bms.has(v.id));
    if (!currentChips.length) return streamable;
    return streamable.filter(v => currentAndMode
      ? currentChips.every(c => matchVideo(v, c))
      : currentChips.some(c => matchVideo(v, c))
    );
  }, [allVids, bms]);

  const filteredList = useMemo(() => getFilteredList(chips, andMode), [chips, andMode, getFilteredList]);

  const reapplyFilter = useCallback((newChips: ZapChip[], newAndMode: boolean) => {
    if (!newChips.length) {
      zapFilteredPool.value = null;
      refillZapQueue();
      return;
    }
    const filtered = getFilteredList(newChips, newAndMode);
    zapFilteredPool.value = filtered;
    setZapQueueFromList(filtered);
  }, [getFilteredList]);

  const addChip = useCallback((chip: ZapChip) => {
    setChips(prev => {
      if (prev.some(c => c.value === chip.value && c.type === chip.type)) return prev;
      const next = [...prev, chip];
      reapplyFilter(next, andMode);
      return next;
    });
    setInputVal('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [andMode, reapplyFilter]);

  const removeChip = useCallback((idx: number) => {
    setChips(prev => {
      const next = prev.filter((_, i) => i !== idx);
      reapplyFilter(next, andMode);
      return next;
    });
  }, [andMode, reapplyFilter]);

  const handleAndModeChange = useCallback((mode: boolean) => {
    setAndMode(mode);
    reapplyFilter(chips, mode);
  }, [chips, reapplyFilter]);

  const handleShuffle = useCallback(() => {
    if (!chips.length) {
      zapFilteredPool.value = null;
      refillZapQueue();
    } else {
      setZapQueueFromList(filteredList);
    }
  }, [chips, filteredList]);

  const handleInputKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && inputVal.trim()) {
      addChip({ value: inputVal.trim(), type: 'text' });
    } else if (e.key === 'Backspace' && !inputVal && chips.length) {
      removeChip(chips.length - 1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }, [inputVal, chips, addChip, removeChip]);

  const suggestions = useMemo((): Suggestion[] => {
    const q = inputVal.toLowerCase().trim();
    if (!q) return [];
    const result: Suggestion[] = [];

    actorList
      .filter(a => a.name.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach(a => result.push({ value: a.name, type: 'actor', label: a.name }));

    folderList
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(f => result.push({ value: f.path || f.name, type: 'folder', label: f.name }));

    const tagSet = new Set<string>();
    outer: for (const v of allVids) {
      for (const t of (v.tags || [])) {
        if (t.toLowerCase().includes(q) && !tagSet.has(t)) {
          tagSet.add(t);
          if (tagSet.size >= 5) break outer;
        }
      }
    }
    tagSet.forEach(t => result.push({ value: t, type: 'tag', label: t }));

    return result;
  }, [inputVal, actorList, folderList, allVids]);

  const chipTypeIcon = (type: ZapChip['type']) => {
    switch (type) {
      case 'actor': return '👤';
      case 'folder': return '📁';
      case 'tag': return '#';
      default: return '⌕';
    }
  };

  const suggTypeLabel = (type: ZapChip['type']) => {
    switch (type) {
      case 'actor': return 'Actor';
      case 'folder': return 'Folder';
      case 'tag': return 'Tag';
      default: return 'Text';
    }
  };

  return (
    <div className="zap-immersive">
      <div className="zap-stage">
        <div className="zap-player-wrap" key={video.id}>
          <AdvancedPlayer
            key={video.id}
            src={src}
            videoId={video.id}
            subtitles={subtitles}
            chapters={chapters}
            language={language}
            videoRef={videoRef}
            isMuted={isMuted.value}
            startTime={zapStartTime.value}
            onNext={doZapSwitch}
            onPrev={jumpToPrevZap}
          />
        </div>
        <video id="zap-preload" className="zap-preload-vid" />
        <div className="zap-title-overlay">{formatVideoTitle(video.name)}</div>
      </div>

      <div className="zap-queue">
        {/* Timer */}
        <div className="zap-sidebar-timer" title={zapLock.value ? 'Locked — auto-zap paused' : 'Time until next video'}>
          <div className="zap-timer-bar">
            <div className="zap-timer-fill" style={{ '--zap-pct': `${zapLock.value ? 0 : pct}%` } as any} />
          </div>
          <span className="zap-timer-label">
            {zapLock.value ? 'Locked' : `Next in ${formatSecs(remaining)}`}
          </span>
        </div>

        {/* Controls */}
        <div className="zap-sidebar-controls">
          <button type="button" onClick={jumpToPrevZap} disabled={!zapHistory.value.length} className="zap-btn" title="Previous video">⏮</button>
          <button type="button" onClick={() => doZapSwitch()} className="zap-btn" title="Skip to next video">⚡ Skip</button>
          <button type="button" onClick={toggleZapLock} className={`zap-btn${zapLock.value ? ' on' : ''}`} title={zapLock.value ? 'Resume zapping' : 'Lock current video'}>
            {zapLock.value ? '🔒' : '🔓'}
          </button>
          <button type="button" onClick={openAndStopZapping} className="zap-btn open" title="Stop zap and open this video">▶ Open</button>
          <button type="button" onClick={stopZapping} className="zap-btn exit" title="Exit zapping mode">✕</button>
        </div>

        {/* Interval sliders */}
        <div className="zap-sidebar-range">
          <label>
            <span>Min {zapMinIv.value}s</span>
            <input type="range" min="1" max="120" value={zapMinIv.value}
              onInput={(e: any) => setZapMinIv(parseInt(e.target.value, 10))} />
          </label>
          <label>
            <span>Max {zapMaxIv.value}s</span>
            <input type="range" min="1" max="180" value={zapMaxIv.value}
              onInput={(e: any) => setZapMaxIv(parseInt(e.target.value, 10))} />
          </label>
        </div>

        {/* Queue header + shuffle */}
        <div className="zap-queue-header">
          <span>Up Next</span>
          <button type="button" className="zap-shuffle-btn" onClick={handleShuffle} title="Shuffle queue with current filter">⇌ Shuffle</button>
        </div>

        {/* Chip filter */}
        <div className="zap-chip-filter">
          <div className="zap-chip-input-row">
            {chips.map((chip, i) => (
              <div key={i} className={`zap-chip zap-chip-${chip.type}`}>
                <span className="zap-chip-icon">{chipTypeIcon(chip.type)}</span>
                <span className="zap-chip-val">{chip.value}</span>
                <button type="button" className="zap-chip-remove" onClick={() => removeChip(i)}>✕</button>
              </div>
            ))}
            <div className="zap-chip-wrap">
              <input
                ref={inputRef}
                type="text"
                className="zap-chip-input"
                placeholder={chips.length ? '' : 'Actor, folder, tag, or text…'}
                value={inputVal}
                onInput={(e: any) => { setInputVal(e.target.value); setShowSuggestions(true); }}
                onKeyDown={handleInputKeyDown as any}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="zap-suggestions">
                  {suggestions.map((s, i) => (
                    <div key={i} className="zap-suggestion-item" onMouseDown={() => addChip({ value: s.value, type: s.type })}>
                      <span className={`zap-suggestion-type zap-stype-${s.type}`}>{suggTypeLabel(s.type)}</span>
                      <span className="zap-suggestion-val">{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {chips.length > 0 && (
            <div className="zap-filter-footer">
              <button type="button" className={`zap-andor-btn${andMode ? ' active' : ''}`} onClick={() => handleAndModeChange(true)} title="Match ALL terms">AND</button>
              <button type="button" className={`zap-andor-btn${!andMode ? ' active' : ''}`} onClick={() => handleAndModeChange(false)} title="Match ANY term">OR</button>
              <span className="zap-filter-count">{filteredList.length} videos</span>
              <button type="button" className="zap-filter-clear" onClick={() => { setChips([]); reapplyFilter([], andMode); }}>Clear</button>
            </div>
          )}
        </div>

        {/* Queue list */}
        <div className="zap-queue-list">
          {zapQueue.value.map((item: ZapQueueItem) => (
            <div key={item.video.id} className="zap-queue-item" onClick={() => jumpToZapVideo(item)}>
              <img
                src={item.video.isVault ? '' : `/api/thumbs/${item.video.id}/0`}
                alt=""
                onError={(e: any) => e.target.style.visibility = 'hidden'}
              />
              <div className="zap-queue-info">
                <div className="zap-queue-name">{formatVideoTitle(item.video.name)}</div>
                <div className="zap-queue-cat">{item.video.category}</div>
              </div>
            </div>
          ))}
          {!zapQueue.value.length && (
            <div className="zap-queue-empty">No videos match filter…</div>
          )}
        </div>
      </div>
    </div>
  );
};
