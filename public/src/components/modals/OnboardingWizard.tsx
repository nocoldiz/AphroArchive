import { useState, useEffect } from 'preact/hooks';
import { importModalState } from '../../store';

interface Preset {
  id: string;
  name: string;
  description?: string;
  counts: {
    categories?: number;
    actors?: number;
    studios?: number;
    websites?: number;
  };
}

type Step = 'welcome' | 'name' | 'preset' | 'contentPath' | 'import';

export const OnboardingWizard = () => {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [profileName, setProfileName] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetMode, setPresetMode] = useState<'blank' | 'preset' | ''>('');
  const [contentPath, setContentPath] = useState('');
  const [browsingPath, setBrowsingPath] = useState(false);
  const [currentDir, setCurrentDir] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);
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

  const handleBlank = () => {
    setPresetMode('blank');
    setSelectedPreset('');
    go('contentPath');
  };

  const handlePickPreset = (id: string) => {
    setPresetMode('preset');
    setSelectedPreset(id);
    go('contentPath');
  };

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

  const confirmPath = () => {
    setBrowsingPath(false);
    go('import');
  };

  const skipPath = () => {
    setContentPath('');
    setBrowsingPath(false);
    go('import');
  };

  const handleCreate = async () => {
    if (!profileName.trim()) { setError('Please enter a profile name'); return; }
    setCreating(true);
    setError('');
    try {
      // Create profile
      const r = await fetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName.trim(),
          preset: selectedPreset || undefined
        }),
      });
      if (!r.ok) throw new Error('Failed to create profile');

      // Set content path if provided
      if (contentPath.trim()) {
        await fetch('/api/settings/prefs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRoot: contentPath.trim() }),
        }).catch(() => {});
      }

      setVisible(false);
      window.location.reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const openImport = async () => {
    // Create the profile first
    if (!profileName.trim()) { setError('Please enter a profile name'); return; }
    setCreating(true);
    setError('');
    try {
      const r = await fetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName.trim(),
          preset: selectedPreset || undefined
        }),
      });
      if (!r.ok) throw new Error('Failed to create profile');

      if (contentPath.trim()) {
        await fetch('/api/settings/prefs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRoot: contentPath.trim() }),
        }).catch(() => {});
      }

      setVisible(false);
      // Small delay to let the wizard close first, then open import
      setTimeout(() => {
        importModalState.value = { visible: true };
      }, 100);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // ── Step: Folder Browser ─────────────────────────────────────────────
  if (browsingPath) {
    return (
      <div className="modal-overlay on" style={{ zIndex: 40000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: '480px', maxWidth: '90vw', padding: '20px' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '12px' }}>Select Content Folder</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--tx3)', marginBottom: '12px' }}>
            {currentDir || 'Loading…'}
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {parentDir && (
              <button
                type="button"
                onClick={() => openFolderBrowser(parentDir)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--ac)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                ..
              </button>
            )}
            {drives.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => openFolderBrowser(d)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--tx)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                {d}
              </button>
            ))}
            {dirs.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => openFolderBrowser(currentDir + '\\' + d)}
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--tx)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                📁 {d}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={skipPath}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={confirmPath}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
            >
              Use This Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Wizard Steps ──────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 'welcome':
        return (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>👋</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.3rem', color: 'var(--tx)' }}>Welcome to AphroArchive!</h2>
            <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--tx2)', lineHeight: 1.6 }}>
              Let's get you set up in a few quick steps.<br />
              You'll create a profile, choose what to start with,<br />
              and optionally import your media right away.
            </p>
            <button
              type="button"
              onClick={() => go('name')}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '10px 28px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 }}
            >
              Get Started →
            </button>
          </div>
        );

      case 'name':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ background: 'var(--ac)', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>1</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Choose a Profile Name</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Your profile stores your library, categories, and settings.
              You can create multiple profiles later for different collections.
            </p>
            <input
              type="text"
              value={profileName}
              onInput={(e: any) => setProfileName(e.target.value)}
              placeholder="e.g. My Collection"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
                borderRadius: '6px', padding: '10px 12px', fontSize: '0.9rem', outline: 'none',
              }}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && profileName.trim()) go('preset'); }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', gap: '8px' }}>
              <button
                type="button"
                onClick={() => go('preset')}
                disabled={!profileName.trim()}
                style={{
                  background: profileName.trim() ? 'var(--ac)' : 'var(--bg3)',
                  color: profileName.trim() ? '#fff' : 'var(--tx3)',
                  border: 'none', padding: '8px 22px', borderRadius: '6px',
                  cursor: profileName.trim() ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.85rem'
                }}
              >
                Next →
              </button>
            </div>
          </div>
        );

      case 'preset':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ background: 'var(--ac)', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>2</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Initial Data Preset</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Start with a curated set of categories, actors, and studios, or begin with a blank slate.
            </p>

            {/* Blank option */}
            <button
              type="button"
              onClick={handleBlank}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 14px',
                background: presetMode === 'blank' ? 'var(--bg3)' : 'var(--bg2)',
                border: presetMode === 'blank' ? '1px solid var(--ac)' : '1px solid var(--brd)',
                borderRadius: '8px', cursor: 'pointer', marginBottom: '10px',
                color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '10px',
              }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>📄</div>
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>Blank Profile</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '1px' }}>Start from scratch — no pre-loaded data</div>
              </div>
            </button>

            {/* Preset options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
              {presets.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePickPreset(p.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '12px 14px',
                    background: selectedPreset === p.id ? 'var(--bg3)' : 'var(--bg2)',
                    border: selectedPreset === p.id ? '1px solid var(--ac)' : '1px solid var(--brd)',
                    borderRadius: '8px', cursor: 'pointer', color: 'var(--tx)',
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}
                >
                  <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>📦</div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '1px' }}>{p.description}</div>}
                    <div style={{ fontSize: '0.65rem', color: 'var(--tx3)', marginTop: '2px', display: 'flex', gap: '6px' }}>
                      {p.counts.categories && <span>{p.counts.categories} folders</span>}
                      {p.counts.actors && <span>{p.counts.actors} actors</span>}
                      {p.counts.studios && <span>{p.counts.studios} studios</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'contentPath':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ background: 'var(--ac)', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>3</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Content Path (Optional)</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
              Point to a folder where your media files are stored.
              You can also add folders later in Settings.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                value={contentPath}
                onInput={(e: any) => setContentPath(e.target.value)}
                placeholder="e.g. C:\Videos"
                style={{
                  flex: 1,
                  background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
                  borderRadius: '6px', padding: '9px 12px', fontSize: '0.85rem', outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => openFolderBrowser()}
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '9px 12px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
              >
                Browse…
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={skipPath}
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => go('import')}
                style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
              >
                Next →
              </button>
            </div>
          </div>
        );

      case 'import':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ background: 'var(--ac)', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>4</span>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Ready to Go!</span>
            </div>

            <div style={{ background: 'var(--bg3)', borderRadius: '8px', padding: '14px', marginBottom: '16px', border: '1px solid var(--brd)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--tx2)', marginBottom: '8px' }}>
                Profile: <strong style={{ color: 'var(--tx)' }}>{profileName}</strong>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--tx2)', marginBottom: '8px' }}>
                Starting with: <strong style={{ color: 'var(--tx)' }}>{presetMode === 'blank' ? 'Blank profile' : (presets.find(p => p.id === selectedPreset)?.name || 'Selected preset')}</strong>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>
                Content path: <strong style={{ color: 'var(--tx)' }}>{contentPath || '(none — you can add later)'}</strong>
              </div>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--tx3)', lineHeight: 1.6 }}>
              You can import media files from your computer now,<br />
              or skip and start browsing right away.
            </p>

            {error && <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#e84040' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
              <button
                type="button"
                onClick={openImport}
                disabled={creating}
                style={{
                  width: '100%', background: 'var(--ac)', border: 'none', color: '#fff',
                  padding: '11px', borderRadius: '8px', cursor: creating ? 'default' : 'pointer',
                  fontWeight: 600, fontSize: '0.9rem', opacity: creating ? 0.6 : 1,
                }}
              >
                📥 Import Media Now
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                style={{
                  width: '100%', background: 'var(--bg3)', border: '1px solid var(--brd)',
                  color: 'var(--tx)', padding: '11px', borderRadius: '8px',
                  cursor: creating ? 'default' : 'pointer', fontWeight: 500, fontSize: '0.9rem',
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? 'Creating Profile…' : 'Skip & Finish'}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ── Step Indicator ───────────────────────────────────────────────────
  const steps: Step[] = ['welcome', 'name', 'preset', 'contentPath', 'import'];
  const currentIdx = steps.indexOf(step);

  return (
    <div className="modal-overlay on" style={{ zIndex: 40000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px',
        width: '460px', maxWidth: '92vw', padding: '24px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>
        {/* Progress bar */}
        {step !== 'welcome' && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
              {steps.slice(1).map((s, i) => (
                <div
                  key={s}
                  style={{
                    flex: 1, height: '3px', borderRadius: '2px',
                    background: i < currentIdx - 1 ? 'var(--ac)' : i === currentIdx - 1 ? 'var(--ac)' : 'var(--brd)',
                    opacity: i < currentIdx - 1 ? 0.6 : i === currentIdx - 1 ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', textAlign: 'right' }}>
              Step {currentIdx} of {steps.length - 1}
            </div>
          </div>
        )}

        {renderStep()}
      </div>
    </div>
  );
};