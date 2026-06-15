import { useState, useEffect } from 'preact/hooks';

interface Preset {
  id: string;
  name: string;
  description?: string;
  counts: {
    categories?: number;
    actors?: number;
    channels?: number;
    websites?: number;
  };
}

const THEMES = [
  { id: 'default',   name: 'Default',      bg: '#1b1b1b', ac: '#ffa31a' },
  { id: 'blue',      name: 'Blue',         bg: '#1e1e22', ac: '#00aff0' },
  { id: 'deepblue',  name: 'Deep Blue',    bg: '#000000', ac: '#0099ff' },
  { id: 'light',     name: 'Light',        bg: '#f0f0f2', ac: '#e2454a' },
  { id: 'artdeco',   name: 'Art Deco',     bg: '#0d0c0a', ac: '#c9a84c' },
  { id: 'ascii',     name: 'ASCII',        bg: '#000000', ac: '#00ff41' },
  { id: 'bi',        name: 'Bisexual',     bg: '#0e0b14', ac: '#d60270' },
  { id: 'trans',     name: 'Trans',        bg: '#0d1a2e', ac: '#55cdfc' },
  { id: 'cyberpunk', name: 'Cyberpunk',    bg: '#020209', ac: '#ffe600' },
  { id: 'neon',      name: 'Neon',         bg: '#000000', ac: '#00ffff' },
  { id: 'galaxy',    name: 'Space Galaxy', bg: '#03000d', ac: '#9d5cff' },
  { id: 'valentine', name: 'Valentine',    bg: '#1a000a', ac: '#ff3388' },
  { id: 'xp',        name: 'Windows XP',  bg: '#d4d0c8', ac: '#2462c8' },
  { id: 'chan',      name: '4chan',         bg: '#eef2ff', ac: '#800000' },
];

const PRESET_COLORS = ['#e8503a', '#3a7be8', '#3abf7a', '#e8a53a', '#9d5cff', '#e83a88', '#3ae8d4', '#8be83a'];

type Step = 'welcome' | 'name' | 'preset' | 'mediaPaths' | 'theme';
const STEPS: Step[] = ['welcome', 'name', 'preset', 'mediaPaths', 'theme'];
const STEP_LABELS: Partial<Record<Step, string>> = {
  name: 'Profile', preset: 'Preset', mediaPaths: 'Folders', theme: 'Theme',
};

export const OnboardingWizard = () => {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [profileName, setProfileName] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetMode, setPresetMode] = useState<'blank' | 'preset' | ''>('');

  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState('./videos');
  const [browsingPath, setBrowsingPath] = useState(false);
  const [currentDir, setCurrentDir] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);

  const [selectedTheme, setSelectedTheme] = useState('default');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/profiles')
      .then(r => r.json())
      .then(data => {
        if (!data.hasDbFiles) {
          setVisible(true);
          fetch('/api/presets')
            .then(r => r.json())
            .then(pdata => setPresets(pdata.profiles || []))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  if (!visible) return null;

  const go = (s: Step) => { setStep(s); setError(''); };
  const prevStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) go(STEPS[idx - 1] as Step);
  };

  const selectBlank = () => { setPresetMode('blank'); setSelectedPreset(''); };
  const selectPreset = (id: string) => { setPresetMode('preset'); setSelectedPreset(id); };

  // ── Folder browser ─────────────────────────────────────────────────────
  const openFolderBrowser = async (dir?: string) => {
    setBrowsingPath(true); setError('');
    try {
      const params = new URLSearchParams();
      if (dir) params.set('path', dir);
      const r = await fetch('/api/settings/browse-folders?' + params.toString());
      const data = await r.json();
      setCurrentDir(data.currentPath);
      setParentDir(data.parent);
      setDirs(data.dirs || []);
      setDrives(data.drives || []);
    } catch {
      setError('Failed to browse folders');
      setBrowsingPath(false);
    }
  };

  const confirmBrowsedPath = () => {
    if (currentDir && !mediaPaths.includes(currentDir))
      setMediaPaths(prev => [...prev, currentDir]);
    setBrowsingPath(false);
  };

  const addPathFromInput = () => {
    const val = pathInput.trim();
    if (!val || mediaPaths.includes(val)) return;
    setMediaPaths(prev => [...prev, val]);
    setPathInput('');
  };

  const removePath = (idx: number) => setMediaPaths(prev => prev.filter((_, i) => i !== idx));

  const previewTheme = (id: string) => {
    setSelectedTheme(id);
    (window as any).applyTheme(id);
  };

  const handleCreate = async () => {
    if (!profileName.trim()) { setError('Please enter a profile name'); return; }
    setCreating(true); setError('');
    try {
      const r = await fetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profileName.trim(), preset: selectedPreset || undefined }),
      });
      if (!r.ok) throw new Error('Failed to create profile');
      const prefsUpdate: Record<string, any> = { theme: selectedTheme };
      if (mediaPaths.length) prefsUpdate.sourceFolders = mediaPaths;
      await fetch('/api/settings/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefsUpdate),
      }).catch(() => {});
      setVisible(false);
      window.location.reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // ── Folder browser overlay ─────────────────────────────────────────────
  if (browsingPath) {
    return (
      <div class="modal-overlay on" style={overlayStyle}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: '480px', maxWidth: '90vw', padding: '20px' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '12px' }}>Select Folder</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--tx3)', marginBottom: '12px' }}>{currentDir || 'Loading…'}</div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {parentDir && (
              <button type="button" onClick={() => openFolderBrowser(parentDir)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--ac)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                ..
              </button>
            )}
            {drives.map(d => (
              <button key={d} type="button" onClick={() => openFolderBrowser(d)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--tx)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                {d}
              </button>
            ))}
            {dirs.map(d => (
              <button key={d} type="button" onClick={() => openFolderBrowser(currentDir + '\\' + d)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--tx)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                📁 {d}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" onClick={() => setBrowsingPath(false)} style={ghostBtn}>Cancel</button>
            <button type="button" onClick={confirmBrowsedPath} style={accentBtn}>Add This Folder</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Progress dots ──────────────────────────────────────────────────────
  const currentIdx = STEPS.indexOf(step);
  const nonWelcomeSteps = STEPS.slice(1);

  const renderProgress = () => {
    if (step === 'welcome') return null;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginBottom: '28px' }}>
        {nonWelcomeSteps.map((s, i) => {
          const globalIdx = i + 1;
          const isActive = s === step;
          const isDone = currentIdx > globalIdx;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
                  background: (isActive || isDone) ? 'var(--ac)' : 'var(--bg3)',
                  border: (isActive || isDone) ? '2px solid var(--ac)' : '2px solid var(--brd)',
                  color: (isActive || isDone) ? '#fff' : 'var(--tx3)',
                  boxShadow: isActive ? '0 0 0 3px rgba(128,128,128,0.18)' : 'none',
                }}>
                  {isDone
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20,6 9,17 4,12"/></svg>
                    : i + 1}
                </div>
                <span style={{ fontSize: '0.62rem', color: isActive ? 'var(--ac)' : isDone ? 'var(--tx2)' : 'var(--tx3)', fontWeight: isActive ? 700 : 400, whiteSpace: 'nowrap' }}>
                  {STEP_LABELS[s]}
                </span>
              </div>
              {i < nonWelcomeSteps.length - 1 && (
                <div style={{ width: '44px', height: '2px', background: isDone ? 'var(--ac)' : 'var(--brd)', margin: '0 4px', marginTop: '12px', opacity: isDone ? 0.7 : 0.35 }} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Step rendering ─────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {

      case 'welcome':
        return (
          <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
            <div style={{ position: 'relative', width: '90px', height: '68px', margin: '0 auto 28px' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'var(--ac)', opacity: 0.18, borderRadius: '10px', transform: 'rotate(-8deg) translate(2px, 6px)' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'var(--ac)', opacity: 0.42, borderRadius: '10px', transform: 'rotate(-4deg) translate(1px, 3px)' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'var(--ac)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <polygon points="6,4 20,12 6,20" fill="rgba(255,255,255,0.9)" />
                </svg>
              </div>
            </div>
            <h1 style={{ margin: '0 0 6px', fontSize: '1.65rem', fontWeight: 800, color: 'var(--tx)', letterSpacing: '-0.03em' }}>
              AphroArchive
            </h1>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--ac)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '14px' }}>
              Personal Video Library
            </div>
            <p style={{ margin: '0 auto 32px', fontSize: '0.82rem', color: 'var(--tx3)', lineHeight: 1.75, maxWidth: '280px' }}>
              Let's take a minute to set up your profile, pick a preset, and make this yours.
            </p>
            <button type="button" onClick={() => go('name')}
              style={{ ...accentBtn, padding: '12px 36px', fontSize: '0.95rem', borderRadius: '8px', fontWeight: 700 }}>
              Get Started →
            </button>
          </div>
        );

      case 'name':
        return (
          <div>
            <h3 style={stepTitle}>Name your profile</h3>
            <p style={stepDesc}>Your profile stores your library, categories, and settings. You can create more later.</p>
            <input
              type="text" value={profileName}
              onInput={(e: any) => setProfileName(e.target.value)}
              placeholder="e.g. My Collection"
              autoFocus
              style={inputStyle}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && profileName.trim()) go('preset'); }}
            />
            <div style={stepFooter}>
              <button type="button" onClick={prevStep} style={backBtn}>← Back</button>
              <button type="button" onClick={() => go('preset')} disabled={!profileName.trim()} style={nextBtn(!!profileName.trim())}>
                Next →
              </button>
            </div>
          </div>
        );

      case 'preset': {
        const canNext = presetMode !== '';
        return (
          <div>
            <h3 style={stepTitle}>Choose a starting preset</h3>
            <p style={stepDesc}>Start with curated categories, actors and channels — or a blank slate. You can import more data later.</p>

            <button type="button" onClick={selectBlank}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 16px', marginBottom: '12px',
                background: presetMode === 'blank' ? 'var(--bg3)' : 'transparent',
                border: presetMode === 'blank' ? '1.5px solid var(--ac)' : '1.5px dashed var(--brd)',
                borderRadius: '8px', cursor: 'pointer', color: 'var(--tx)',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Blank Slate</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--tx3)', marginTop: '2px' }}>Start from scratch — no pre-loaded data</div>
              </div>
            </button>

            {presets.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {presets.map((p, i) => {
                  const color = PRESET_COLORS[i % PRESET_COLORS.length];
                  const isSelected = selectedPreset === p.id && presetMode === 'preset';
                  const counts = [
                    p.counts.categories ? `${p.counts.categories} folders` : '',
                    p.counts.actors ? `${p.counts.actors} actors` : '',
                    p.counts.channels ? `${p.counts.channels} channels` : '',
                  ].filter(Boolean);
                  return (
                    <button key={p.id} type="button" onClick={() => selectPreset(p.id)}
                      style={{
                        textAlign: 'left', padding: '12px 14px',
                        background: isSelected ? 'var(--bg3)' : 'var(--bg2)',
                        border: isSelected ? '1.5px solid var(--ac)' : '1.5px solid var(--brd)',
                        borderRadius: '8px', cursor: 'pointer', color: 'var(--tx)',
                        display: 'flex', flexDirection: 'column', gap: '8px',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '8px',
                          background: color, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexShrink: 0,
                          fontSize: '0.9rem', fontWeight: 800, color: '#fff',
                        }}>
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                      </div>
                      {p.description && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', lineHeight: 1.4 }}>{p.description}</div>
                      )}
                      {counts.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {counts.map(c => (
                            <span key={c} style={{ fontSize: '0.6rem', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 5px', color: 'var(--tx3)' }}>
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={stepFooter}>
              <button type="button" onClick={prevStep} style={backBtn}>← Back</button>
              <button type="button" onClick={() => go('mediaPaths')} disabled={!canNext} style={nextBtn(canNext)}>
                Next →
              </button>
            </div>
          </div>
        );
      }

      case 'mediaPaths':
        return (
          <div>
            <h3 style={stepTitle}>Add media folders</h3>
            <p style={stepDesc}>Point to the folders where your videos live. You can add more any time in Settings.</p>

            {mediaPaths.length > 0 && (
              <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {mediaPaths.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 10px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--tx)', wordBreak: 'break-all' }}>📁 {p}</span>
                    <button type="button" onClick={() => removePath(i)}
                      style={{ background: 'none', border: 'none', color: '#e84040', cursor: 'pointer', fontSize: '1.1rem', padding: '0 4px', flexShrink: 0, marginLeft: '8px' }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
              <input type="text" value={pathInput}
                onInput={(e: any) => setPathInput(e.target.value)}
                placeholder="C:\Videos"
                style={{ ...inputStyle, flex: 1 }}
                onKeyDown={(e: any) => { if (e.key === 'Enter') addPathFromInput(); }}
              />
              <button type="button" onClick={() => openFolderBrowser()} style={ghostBtn}>Browse…</button>
              <button type="button" onClick={addPathFromInput} disabled={!pathInput.trim()} style={nextBtn(!!pathInput.trim())}>Add</button>
            </div>

            <div style={stepFooter}>
              <button type="button" onClick={prevStep} style={backBtn}>← Back</button>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button type="button" onClick={() => go('theme')}
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '0.78rem', padding: '4px' }}>
                  Skip
                </button>
                <button type="button" onClick={() => go('theme')} style={nextBtn(true)}>Next →</button>
              </div>
            </div>
          </div>
        );

      case 'theme':
        return (
          <div>
            <h3 style={stepTitle}>Pick a theme</h3>
            <p style={stepDesc}>Customize your interface — change it any time in Settings.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' }}>
              {THEMES.map(t => {
                const isSelected = selectedTheme === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => previewTheme(t.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                      padding: '10px 6px', borderRadius: '8px', cursor: 'pointer',
                      border: isSelected ? '2px solid var(--ac)' : '1.5px solid var(--brd)',
                      background: isSelected ? 'var(--bg3)' : 'transparent',
                    }}>
                    <div style={{
                      width: '52px', height: '34px', borderRadius: '6px',
                      background: `linear-gradient(135deg, ${t.bg} 50%, ${t.ac} 100%)`,
                      border: '1px solid rgba(255,255,255,0.07)',
                    }} />
                    <span style={{ fontSize: '0.65rem', color: isSelected ? 'var(--ac)' : 'var(--tx2)', fontWeight: isSelected ? 700 : 400, textAlign: 'center', lineHeight: 1.2, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#e84040' }}>{error}</p>}

            <div style={stepFooter}>
              <button type="button" onClick={prevStep} style={backBtn}>← Back</button>
              <button type="button" onClick={handleCreate} disabled={creating}
                style={{ ...accentBtn, minWidth: '140px', opacity: creating ? 0.6 : 1, cursor: creating ? 'default' : 'pointer', borderRadius: '8px', padding: '10px 24px', fontWeight: 700, fontSize: '0.9rem' }}>
                {creating ? 'Setting up…' : 'Finish Setup →'}
              </button>
            </div>
          </div>
        );

      default: return null;
    }
  };

  return (
    <div class="modal-overlay on" style={overlayStyle}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '14px',
        width: '540px', maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto',
        padding: '28px', boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>
        {renderProgress()}
        {renderStep()}
      </div>
    </div>
  );
};

// ── Shared styles ──────────────────────────────────────────────────────────
const overlayStyle: any = {
  zIndex: 40000, display: 'flex', position: 'fixed', inset: 0,
  alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)',
};

const stepTitle: any  = { margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--tx)' };
const stepDesc: any   = { margin: '0 0 18px', fontSize: '0.8rem', color: 'var(--tx3)', lineHeight: 1.65 };
const stepFooter: any = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' };

const inputStyle: any = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
  borderRadius: '6px', padding: '10px 12px', fontSize: '0.85rem', outline: 'none',
};

const accentBtn: any = {
  background: 'var(--ac)', border: 'none', color: '#fff',
  padding: '9px 20px', borderRadius: '6px', cursor: 'pointer',
  fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap',
};

const ghostBtn: any = {
  background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)',
  padding: '9px 14px', borderRadius: '6px', cursor: 'pointer',
  fontSize: '0.8rem', whiteSpace: 'nowrap',
};

const backBtn: any = {
  background: 'none', border: 'none', color: 'var(--tx3)',
  padding: '4px 0', cursor: 'pointer', fontSize: '0.8rem',
};

const nextBtn = (enabled: boolean): any => ({
  background: enabled ? 'var(--ac)' : 'var(--bg3)',
  color: enabled ? '#fff' : 'var(--tx3)',
  border: 'none', padding: '9px 22px', borderRadius: '6px',
  cursor: enabled ? 'pointer' : 'default', fontWeight: 700, fontSize: '0.85rem',
  whiteSpace: 'nowrap',
});
