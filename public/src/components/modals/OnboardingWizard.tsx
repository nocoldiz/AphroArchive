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
  { id: 'default',   name: 'Default',          bg: '#1b1b1b', ac: '#ffa31a' },
  { id: 'blue',      name: 'Blue',              bg: '#1e1e22', ac: '#00aff0' },
  { id: 'deepblue',  name: 'Deep Blue',         bg: '#000000', ac: '#0099ff' },
  { id: 'light',     name: 'Light',             bg: '#f0f0f2', ac: '#e2454a' },
  { id: 'artdeco',   name: 'Art Deco',          bg: '#0d0c0a', ac: '#c9a84c' },
  { id: 'ascii',     name: 'ASCII',             bg: '#000000', ac: '#00ff41' },
  { id: 'bi',        name: 'Bisexual',          bg: '#0e0b14', ac: '#d60270' },
  { id: 'trans',     name: 'Trans',             bg: '#0d1a2e', ac: '#55cdfc' },
  { id: 'cyberpunk', name: 'Cyberpunk',         bg: '#020209', ac: '#ffe600' },
  { id: 'neon',      name: 'Neon',              bg: '#000000', ac: '#00ffff' },
  { id: 'galaxy',    name: 'Space Galaxy',      bg: '#03000d', ac: '#9d5cff' },
  { id: 'valentine', name: 'Valentine',         bg: '#1a000a', ac: '#ff3388' },
  { id: 'xp',        name: 'Windows XP',        bg: '#d4d0c8', ac: '#2462c8' },
  { id: 'chan',       name: '4chan',             bg: '#eef2ff', ac: '#800000' },
];

type Step = 'welcome' | 'name' | 'preset' | 'mediaPaths' | 'theme';

export const OnboardingWizard = () => {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [profileName, setProfileName] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetMode, setPresetMode] = useState<'blank' | 'preset' | ''>('');

  // multi-path state
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState('');
  const [browsingPath, setBrowsingPath] = useState(false);
  const [currentDir, setCurrentDir] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);

  // theme state
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

  const handleBlank = () => { setPresetMode('blank'); setSelectedPreset(''); go('mediaPaths'); };
  const handlePickPreset = (id: string) => { setPresetMode('preset'); setSelectedPreset(id); go('mediaPaths'); };

  // ── Folder browser ──────────────────────────────────────────────────────
  const openFolderBrowser = async (dir?: string) => {
    setBrowsingPath(true);
    setError('');
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
    if (currentDir && !mediaPaths.includes(currentDir)) {
      setMediaPaths(prev => [...prev, currentDir]);
    }
    setBrowsingPath(false);
  };

  const addPathFromInput = () => {
    const val = pathInput.trim();
    if (!val) return;
    if (!mediaPaths.includes(val)) setMediaPaths(prev => [...prev, val]);
    setPathInput('');
  };

  const removePath = (idx: number) => setMediaPaths(prev => prev.filter((_, i) => i !== idx));

  // ── Theme preview ───────────────────────────────────────────────────────
  const previewTheme = (id: string) => {
    setSelectedTheme(id);
    (window as any).applyTheme(id);
  };

  // ── Finish setup ────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!profileName.trim()) { setError('Please enter a profile name'); return; }
    setCreating(true);
    setError('');
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

  // ── Folder browser overlay ──────────────────────────────────────────────
  if (browsingPath) {
    return (
      <div className="modal-overlay on" style={{ zIndex: 40000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
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
            <button type="button" onClick={() => setBrowsingPath(false)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
              Cancel
            </button>
            <button type="button" onClick={confirmBrowsedPath}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              Add This Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step rendering ──────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {

      case 'welcome':
        return (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>👋</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.3rem', color: 'var(--tx)' }}>Welcome to AphroArchive!</h2>
            <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--tx2)', lineHeight: 1.6 }}>
              Let's get you set up in a few quick steps.<br />
              You'll name your profile, choose a starting preset,<br />
              point to your media, and pick a theme.
            </p>
            <button type="button" onClick={() => go('name')}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '10px 28px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 }}>
              Get Started →
            </button>
          </div>
        );

      case 'name':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={stepBadge}>1</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Profile Name</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Your profile stores your library, categories, and settings.
              You can create more profiles later.
            </p>
            <input
              type="text"
              value={profileName}
              onInput={(e: any) => setProfileName(e.target.value)}
              placeholder="e.g. My Collection"
              autoFocus
              style={inputStyle}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && profileName.trim()) go('preset'); }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button type="button" onClick={() => go('preset')} disabled={!profileName.trim()} style={nextBtn(!!profileName.trim())}>
                Next →
              </button>
            </div>
          </div>
        );

      case 'preset':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={stepBadge}>2</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Starting Preset</span>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Start with a curated set of categories, actors, and channels — or begin with a blank slate.
            </p>

            <button type="button" onClick={handleBlank} style={presetCard(presetMode === 'blank')}>
              <div style={presetIcon}>📄</div>
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>Blank Profile</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '1px' }}>Start from scratch — no pre-loaded data</div>
              </div>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
              {presets.map(p => (
                <button key={p.id} type="button" onClick={() => handlePickPreset(p.id)} style={presetCard(selectedPreset === p.id)}>
                  <div style={presetIcon}>📦</div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '1px' }}>{p.description}</div>}
                    <div style={{ fontSize: '0.65rem', color: 'var(--tx3)', marginTop: '2px', display: 'flex', gap: '6px' }}>
                      {p.counts.categories && <span>{p.counts.categories} folders</span>}
                      {p.counts.actors && <span>{p.counts.actors} actors</span>}
                      {p.counts.channels && <span>{p.counts.channels} channels</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'mediaPaths':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={stepBadge}>3</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Media Folders</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Add one or more folders where your media files are stored. You can also manage these later in Settings.
            </p>

            {/* Added paths list */}
            {mediaPaths.length > 0 && (
              <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {mediaPaths.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 10px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--tx)', wordBreak: 'break-all' }}>📁 {p}</span>
                    <button type="button" onClick={() => removePath(i)}
                      style={{ background: 'none', border: 'none', color: '#e84040', cursor: 'pointer', fontSize: '1rem', padding: '0 4px', flexShrink: 0, marginLeft: '8px' }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add path row */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <input
                type="text"
                value={pathInput}
                onInput={(e: any) => setPathInput(e.target.value)}
                placeholder="C:\Videos"
                style={{ ...inputStyle, flex: 1 }}
                onKeyDown={(e: any) => { if (e.key === 'Enter') addPathFromInput(); }}
              />
              <button type="button" onClick={() => openFolderBrowser()}
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '9px 12px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                Browse…
              </button>
              <button type="button" onClick={addPathFromInput} disabled={!pathInput.trim()}
                style={{ background: pathInput.trim() ? 'var(--ac)' : 'var(--bg3)', border: 'none', color: pathInput.trim() ? '#fff' : 'var(--tx3)', borderRadius: '6px', padding: '9px 14px', cursor: pathInput.trim() ? 'pointer' : 'default', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Add
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={() => go('theme')}
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                Skip
              </button>
              <button type="button" onClick={() => go('theme')}
                style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                Next →
              </button>
            </div>
          </div>
        );

      case 'theme':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={stepBadge}>4</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Choose a Theme</span>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Pick a color scheme — you can change it any time in Settings.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px', maxHeight: '220px', overflowY: 'auto', marginBottom: '16px' }}>
              {THEMES.map(t => {
                const isSelected = selectedTheme === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => previewTheme(t.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                      padding: '10px 8px', borderRadius: '8px', cursor: 'pointer',
                      border: isSelected ? '2px solid var(--ac)' : '1px solid var(--brd)',
                      background: isSelected ? 'var(--bg3)' : 'var(--bg2)',
                    }}>
                    <div style={{
                      width: '48px', height: '28px', borderRadius: '4px',
                      background: `linear-gradient(135deg, ${t.bg} 50%, ${t.ac} 100%)`,
                      border: '1px solid rgba(255,255,255,0.08)',
                    }} />
                    <span style={{ fontSize: '0.7rem', color: isSelected ? 'var(--ac)' : 'var(--tx2)', fontWeight: isSelected ? 600 : 400, textAlign: 'center', lineHeight: 1.2 }}>{t.name}</span>
                  </button>
                );
              })}
            </div>

            {error && <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#e84040' }}>{error}</p>}

            <button type="button" onClick={handleCreate} disabled={creating}
              style={{ width: '100%', background: 'var(--ac)', border: 'none', color: '#fff', padding: '12px', borderRadius: '8px', cursor: creating ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.95rem', opacity: creating ? 0.6 : 1 }}>
              {creating ? 'Setting up…' : 'Finish Setup →'}
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  // ── Progress bar (excludes welcome) ─────────────────────────────────────
  const STEPS: Step[] = ['welcome', 'name', 'preset', 'mediaPaths', 'theme'];
  const currentIdx = STEPS.indexOf(step);

  return (
    <div className="modal-overlay on" style={{ zIndex: 40000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: '480px', maxWidth: '92vw', padding: '24px', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
        {step !== 'welcome' && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
              {STEPS.slice(1).map((s, i) => (
                <div key={s} style={{
                  flex: 1, height: '3px', borderRadius: '2px',
                  background: i < currentIdx - 1 ? 'var(--ac)' : i === currentIdx - 1 ? 'var(--ac)' : 'var(--brd)',
                  opacity: i < currentIdx - 1 ? 0.5 : i === currentIdx - 1 ? 1 : 0.25,
                }} />
              ))}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', textAlign: 'right' }}>
              Step {currentIdx} of {STEPS.length - 1}
            </div>
          </div>
        )}
        {renderStep()}
      </div>
    </div>
  );
};

// ── Shared style helpers ───────────────────────────────────────────────────
const stepBadge: any = {
  background: 'var(--ac)', color: '#fff', borderRadius: '50%',
  width: '24px', height: '24px', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
};

const inputStyle: any = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
  borderRadius: '6px', padding: '10px 12px', fontSize: '0.85rem', outline: 'none',
};

const nextBtn = (enabled: boolean): any => ({
  background: enabled ? 'var(--ac)' : 'var(--bg3)',
  color: enabled ? '#fff' : 'var(--tx3)',
  border: 'none', padding: '8px 22px', borderRadius: '6px',
  cursor: enabled ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.85rem',
});

const presetCard = (selected: boolean): any => ({
  width: '100%', textAlign: 'left', padding: '12px 14px',
  background: selected ? 'var(--bg3)' : 'var(--bg2)',
  border: selected ? '1px solid var(--ac)' : '1px solid var(--brd)',
  borderRadius: '8px', cursor: 'pointer', marginBottom: '8px',
  color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '10px',
});

const presetIcon: any = {
  width: '32px', height: '32px', borderRadius: '6px', background: 'var(--bg3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0,
};
