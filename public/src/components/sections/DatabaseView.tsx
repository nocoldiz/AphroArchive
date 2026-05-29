/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks';
import { presetPickerState, activeProfile } from '../../store';
import { ActorScraperView } from './ActorScraperView';

interface DbEntry {
  name: string;
  data: any;
}

export const DatabaseView = () => {
  const [activeTab, setActiveTab] = useState('folders');
  const [entries, setEntries] = useState<[string, any][]>([]);
  const [loading, setLoading] = useState(false);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [scraperModalOpen, setScraperModalOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});

  const [folders, setFolders] = useState<{name: string, path: string, isExternal?: boolean}[]>([]);
  const [enabledFolders, setEnabledFolders] = useState<Set<string>>(new Set());
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [newSourceFolder, setNewSourceFolder] = useState('');

  const tabs = [
    { id: 'folders', name: 'Categories' },
    { id: 'actors', name: 'Actors' },
    { id: 'categories', name: 'Tags' },
    { id: 'studios', name: 'Studios' },
    { id: 'websites', name: 'Websites' },
    { id: 'duplicates', name: 'Duplicates' }
  ];

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab]);

  const loadTab = async (tab: string) => {
    if (tab === 'duplicates') {
      setEntries([]);
      return;
    }
    if (tab === 'folders') {
      setLoading(true);
      try {
        const [foldersRes, prefsRes] = await Promise.all([
          fetch('/api/all-categories'),
          fetch('/api/settings/prefs'),
        ]);
        const foldersData = await foldersRes.json();
        const prefsData = await prefsRes.json();
        const actualPaths = new Set((foldersData.categories as any[]).map(f => f.path));
        setFolders(foldersData.categories);
        setEnabledFolders(new Set((foldersData.enabled as string[]).filter(p => actualPaths.has(p))));
        setSourceFolders(prefsData.sourceFolders || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/db/${tab}`);
      const data = await r.json();
      setEntries(Object.entries(data));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    const r = await fetch(`/api/db/${activeTab}/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok) {
      loadTab(activeTab);
      const w = window as any;
      if (w.toast) w.toast('Deleted');
    } else {
      const w = window as any;
      if (w.toast) w.toast('Delete failed');
    }
  };

  const openModal = (name: string | null, data: any = {}) => {
    setEditName(name);
    setFormData(data);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const name = activeTab === 'websites'
      ? (formData.name?.trim() || editName)
      : (editName || formData.name?.trim());
    if (!name) { alert('Name is required'); return; }

    const r = await fetch(`/api/db/${activeTab}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, oldName: editName || undefined, data: formData })
    });
    
    if (r.ok) {
      setModalOpen(false);
      loadTab(activeTab);
      const w = window as any;
      if (w.toast) w.toast('Saved');
    } else {
      const w = window as any;
      if (w.toast) w.toast('Save failed');
    }
  };

  const updateFormField = (key: string, value: string) => {
    setFormData({ ...formData, [key]: value });
  };

  const handleReset = async () => {
    const profile = activeProfile.value;
    if (!confirm(`Reset profile "${profile}" to its initial preset data? This will overwrite categories, studios, and websites!`)) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: [profile], merge: false }),
      });
      if (!res.ok) throw new Error('Server error');
      
      const w = window as any;
      if (w.toast) w.toast('Profile reset complete');
      loadTab(activeTab);
    } catch (e: any) {
      alert('Reset failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFolders = async () => {
    try {
      const res = await fetch('/api/enabled-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: Array.from(enabledFolders) }),
      });
      if (!res.ok) throw new Error('Server error');

      const w = window as any;
      if (w.toast) w.toast('Categories visibility saved');
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleAddSourceFolder = async () => {
    const val = newSourceFolder.trim();
    if (!val) return;
    if (sourceFolders.includes(val)) {
      const w = window as any;
      if (w.toast) w.toast('Folder already added');
      return;
    }
    const updated = [...sourceFolders, val];
    try {
      const res = await fetch('/api/settings/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFolders: updated }),
      });
      if (!res.ok) throw new Error('Server error');
      setNewSourceFolder('');
      loadTab('folders');
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleRemoveSourceFolder = async (folder: string) => {
    const updated = sourceFolders.filter(f => f !== folder);
    try {
      const res = await fetch('/api/settings/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFolders: updated }),
      });
      if (!res.ok) throw new Error('Server error');
      loadTab('folders');
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleBrowseNative = async () => {
    try {
      const res = await fetch('/api/browse-folders-native');
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      if (data.path) setNewSourceFolder(data.path);
    } catch (e) {}
  };

  return (
    <div id="database-view" className="database-view on" style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>Database Management</h2>
      
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--brd)', paddingBottom: '10px' }}>
        {tabs.map(t => (
          <button 
            key={t.id} 
            className={`db-tab ${activeTab === t.id ? 'on' : ''}`}
            onClick={() => setActiveTab(t.id)}
            style={{ 
              padding: '8px 16px', 
              background: activeTab === t.id ? 'var(--ac)' : 'transparent',
              color: activeTab === t.id ? '#fff' : 'var(--tx2)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Action Bar */}
      {activeTab !== 'duplicates' && activeTab !== 'folders' && (
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="modal-btn" onClick={() => { presetPickerState.value = { visible: true, mergeMode: false }; }} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Import Preset as Profile</button>
          <button className="modal-btn" onClick={handleReset} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Reset to Preset</button>
          {activeTab === 'actors' && (
            <button className="modal-btn" onClick={() => setScraperModalOpen(true)} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Scrape Actor Data</button>
          )}
          <button className="modal-btn modal-btn--primary" onClick={() => openModal(null)}>+ Add Entry</button>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>Loading…</div>
      ) : activeTab === 'folders' ? (
        <div>
          {/* Source Folders Management */}
          <div style={{ marginBottom: '24px', background: 'var(--bg2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--brd)' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--ac)' }}>Source Folders</h4>
            {sourceFolders.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--tx3)', marginBottom: '8px' }}>No source folders added. Files from added folders appear alongside your main library.</div>
            ) : (
              sourceFolders.map(f => (
                <div key={f} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', background: 'var(--bg3)', padding: '8px 10px', borderRadius: '4px' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--tx)', wordBreak: 'break-all', marginRight: '8px' }}>{f}</span>
                  <button onClick={() => handleRemoveSourceFolder(f)} style={{ flexShrink: 0, background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>Remove</button>
                </div>
              ))
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input
                type="text"
                value={newSourceFolder}
                onInput={(e: any) => setNewSourceFolder(e.target.value)}
                onKeyDown={(e: any) => e.key === 'Enter' && handleAddSourceFolder()}
                placeholder="C:\path\to\folder"
                style={{ flex: 1, padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', fontSize: '0.85rem' }}
              />
              <button onClick={handleBrowseNative} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Browse</button>
              <button onClick={handleAddSourceFolder} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Add</button>
            </div>
          </div>

          {/* Category visibility */}
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--tx3)' }}>
              {enabledFolders.size === 0
                ? 'All categories visible (none explicitly enabled)'
                : `${folders.filter(f => enabledFolders.has(f.path)).length} of ${folders.length} categories enabled`}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="modal-btn" onClick={() => setEnabledFolders(new Set())}>Enable All</button>
              <button type="button" className="modal-btn modal-btn--primary" onClick={handleSaveFolders}>Save</button>
            </div>
          </div>
          {folders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>
              No categories found in videos directory or source folders.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {folders.map(f => (
                <label key={f.path} style={{ background: 'var(--bg2)', padding: '12px', borderRadius: '8px', border: `1px solid ${f.isExternal ? 'var(--ac)' : 'var(--brd)'}`, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enabledFolders.size === 0 || enabledFolders.has(f.path)}
                    onChange={(e: any) => {
                      const next = new Set(enabledFolders);
                      if (enabledFolders.size === 0) {
                        folders.forEach(fold => { if (fold.path !== f.path) next.add(fold.path); });
                      } else {
                        if (e.target.checked) next.add(f.path);
                        else next.delete(f.path);
                      }
                      setEnabledFolders(next);
                    }}
                  />
                  <span style={{ fontSize: '0.9rem', flex: 1 }}>{f.name}</span>
                  {f.isExternal && <span style={{ fontSize: '0.7rem', color: 'var(--ac)', opacity: 0.8, flexShrink: 0 }}>external</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>No entries found.</div>
      ) : (
        <div className="db-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
          {entries.map(([name, info]) => (
            <div key={name} className="db-card" style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--brd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontWeight: 'bold' }}>{name}</span>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button onClick={() => openModal(name, info)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                  <button onClick={() => handleDelete(name)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>
                {activeTab === 'actors' && (
                  <>
                    {info.date_of_birth && <div>Born: {info.date_of_birth}</div>}
                    {info.nationality && <div>From: {info.nationality}</div>}
                    {info.imdb_page && <a href={info.imdb_page} target="_blank" style={{ color: 'var(--ac)' }}>IMDb ↗</a>}
                  </>
                )}
                {activeTab === 'categories' && (
                  <div>Tags: {Array.isArray(info.tags) ? info.tags.join(', ') : ''}</div>
                )}
                {activeTab === 'studios' && (
                  <>
                    {info.website && <a href={info.website} target="_blank" style={{ color: 'var(--ac)' }}>Website ↗</a>}
                    {info.short_description && <div style={{ marginTop: '5px' }}>{info.short_description}</div>}
                  </>
                )}
                {activeTab === 'websites' && (
                  <>
                    {info.url && <a href={info.url} target="_blank" style={{ color: 'var(--ac)' }}>Visit ↗</a>}
                    {info.scrapeMethod && <div>Method: {info.scrapeMethod}</div>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '400px', maxWidth: '90%' }}>
            <h3 style={{ marginBottom: '20px' }}>{editName ? `Edit — ${editName}` : 'Add Entry'}</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Name</label>
                <input
                  type="text"
                  value={activeTab === 'websites' ? (formData.name ?? editName ?? '') : (editName || formData.name || '')}
                  onInput={(e: any) => updateFormField('name', e.target.value)}
                  disabled={!!editName && activeTab !== 'websites'}
                  style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
                />
              </div>

              {activeTab === 'actors' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>IMDb URL</label>
                    <input type="text" value={formData.imdb_page || ''} onInput={(e: any) => updateFormField('imdb_page', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Date of Birth</label>
                    <input type="text" value={formData.date_of_birth || ''} onInput={(e: any) => updateFormField('date_of_birth', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Nationality</label>
                    <input type="text" value={formData.nationality || ''} onInput={(e: any) => updateFormField('nationality', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Movies</label>
                    <textarea value={formData.movies || ''} onInput={(e: any) => updateFormField('movies', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', minHeight: '70px' }} />
                  </div>
                </>
              )}

              {activeTab === 'categories' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Tags / Aliases (comma-separated)</label>
                  <input 
                    type="text" 
                    value={Array.isArray(formData.tags) ? formData.tags.join(', ') : ''} 
                    onInput={(e: any) => updateFormField('tags', e.target.value.split(',').map((t: string) => t.trim()))}
                    style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
                  />
                </div>
              )}

              {activeTab === 'studios' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Website URL</label>
                    <input type="text" value={formData.website || ''} onInput={(e: any) => updateFormField('website', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Description</label>
                    <textarea value={formData.short_description || ''} onInput={(e: any) => updateFormField('short_description', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', minHeight: '70px' }} />
                  </div>
                </>
              )}

              {activeTab === 'websites' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>URL</label>
                    <input type="text" value={formData.url || ''} onInput={(e: any) => updateFormField('url', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Search URL</label>
                    <input type="text" value={formData.searchURL || ''} onInput={(e: any) => updateFormField('searchURL', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Scrape Method</label>
                    <input type="text" value={formData.scrapeMethod || ''} onInput={(e: any) => updateFormField('scrapeMethod', e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }} />
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button className="modal-btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="modal-btn modal-btn--primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Scraper Modal */}
      {scraperModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '900px', maxWidth: '95%', maxHeight: '90%', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setScraperModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            <ActorScraperView />
          </div>
        </div>
      )}
    </div>
  );
};
