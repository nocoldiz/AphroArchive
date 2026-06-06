/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { presetPickerState, activeProfile, dbPendingOpen, loadVideos } from '../../store';
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
  const [enabledFolders, setEnabledFolders] = useState<Set<string> | null>(null);
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [defaultRoot, setDefaultRoot] = useState<string>('');
  const [newSourceFolder, setNewSourceFolder] = useState('');

  const importFileRef = useRef<HTMLInputElement>(null);
  const importAllRef = useRef<HTMLInputElement>(null);
  const importWcRef = useRef<HTMLInputElement>(null);

  // Preset import modal
  const [presetImportOpen, setPresetImportOpen] = useState(false);
  const [presetList, setPresetList] = useState<{id: string, name: string, description: string, counts: Record<string,number>}[]>([]);
  const [presetImporting, setPresetImporting] = useState<string | null>(null);

  // Wildcards tab state
  const [wcList, setWcList] = useState<{name: string, count: number, preview: string[]}[]>([]);
  const [wcExpanded, setWcExpanded] = useState<string | null>(null);
  const [wcEditContent, setWcEditContent] = useState<string>('');
  const [wcEditSaving, setWcEditSaving] = useState(false);
  const [wcNewName, setWcNewName] = useState('');
  const [wcCreating, setWcCreating] = useState(false);

  // Website-from-links
  const [linkSitesCandidates, setLinkSitesCandidates] = useState<{name: string, url: string}[]>([]);
  const [linkSitesSelected, setLinkSitesSelected] = useState<Set<string>>(new Set());
  const [linkSitesOpen, setLinkSitesOpen] = useState(false);

  const tabs = [
    { id: 'folders', name: 'Folders' },
    { id: 'actors', name: 'Actors' },
    { id: 'categories', name: 'Tags' },
    { id: 'studios', name: 'Studios' },
    { id: 'websites', name: 'Websites' },
    { id: 'wildcards', name: 'Wildcards' },
  ];

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    return dbPendingOpen.subscribe(val => {
      if (!val) return;
      setActiveTab(val.tab);
      if (val.action === 'add') {
        setEditName(null);
        setFormData({});
        setModalOpen(true);
      }
      dbPendingOpen.value = null;
    });
  }, []);

  const loadTab = async (tab: string) => {
    if (tab === 'wildcards') {
      setLoading(true);
      try {
        const r = await fetch('/api/imagegen/assets');
        const d = await r.json();
        setWcList(d.wildcards || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
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
        const enabledArr = (foldersData.enabled as string[]).filter(p => actualPaths.has(p));
        setEnabledFolders(enabledArr.length === 0 ? null : new Set(enabledArr));
        setSourceFolders(prefsData.sourceFolders || []);
        setDefaultRoot(prefsData.defaultRoot || prefsData.defaultPath || prefsData.defaultWriteRoot || '');
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
        body: JSON.stringify({ paths: enabledFolders === null ? [] : Array.from(enabledFolders) }),
      });
      if (!res.ok) throw new Error('Server error');

      const w = window as any;
      if (w.toast) w.toast('Folders visibility saved');
      await loadVideos();
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

  const handleSetDefaultRoot = async (val: string) => {
    const v = val || '';
    try {
      const res = await fetch('/api/settings/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRoot: v }),
      });
      if (!res.ok) throw new Error('Server error');
      setDefaultRoot(v);
      const w = window as any;
      if (w.toast) w.toast('Default path updated for downloads/moves');
    } catch (e: any) {
      alert('Error saving default path: ' + e.message);
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

  const handleExportJson = () => {
    const a = document.createElement('a');
    a.href = `/api/db/${activeTab}/export`;
    a.download = `${activeTab}.json`;
    a.click();
  };

  const handleExportAll = async () => {
    const tabs = ['actors', 'categories', 'studios', 'websites'];
    const results = await Promise.all(tabs.map(t => fetch(`/api/db/${t}/export`).then(r => r.json())));
    const combined = Object.fromEntries(tabs.map((t, i) => [t, results[i]]));
    const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'db-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportAll = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let data: any;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert('Invalid JSON file');
      return;
    }
    const knownTabs = ['actors', 'categories', 'studios', 'websites'];
    const toImport = knownTabs.filter(t => data[t]);
    if (!toImport.length) { alert('No recognizable sections found (expected actors/categories/studios/websites)'); return; }
    const results = await Promise.all(
      toImport.map(t => fetch(`/api/db/${t}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data[t]),
      }).then(r => r.ok ? r.json() : null))
    );
    const total = results.reduce((s, r) => s + (r?.count ?? 0), 0);
    const w = window as any;
    if (w.toast) w.toast(`Imported ${total} entries across ${toImport.join(', ')}`);
    loadTab(activeTab);
  };

  const handleImportJson = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let data: any;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert('Invalid JSON file');
      return;
    }
    const r = await fetch(`/api/db/${activeTab}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const w = window as any;
    if (r.ok) {
      const d = await r.json();
      if (w.toast) w.toast(`Imported ${d.count} entries`);
      loadTab(activeTab);
    } else {
      if (w.toast) w.toast('Import failed');
    }
  };

  const openPresetImport = async () => {
    const r = await fetch('/api/presets');
    const data = await r.json();
    setPresetList(data.profiles || []);
    setPresetImportOpen(true);
  };

  const applyPresetImport = async (id: string) => {
    setPresetImporting(id);
    try {
      const r = await fetch('/api/presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: [id], merge: true }),
      });
      if (!r.ok) throw new Error('Server error');
      const w = window as any;
      if (w.toast) w.toast('Preset merged into DB');
      setPresetImportOpen(false);
      loadTab(activeTab);
    } catch (e: any) {
      alert('Import failed: ' + e.message);
    } finally {
      setPresetImporting(null);
    }
  };

  // ── Wildcard handlers ────────────────────────────────────────────────

  const handleWcEdit = async (name: string) => {
    if (wcExpanded === name) { setWcExpanded(null); return; }
    const r = await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`);
    const d = await r.json();
    setWcEditContent(d.content || '');
    setWcExpanded(name);
  };

  const handleWcSave = async (name: string) => {
    setWcEditSaving(true);
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: wcEditContent }),
    });
    setWcEditSaving(false);
    setWcExpanded(null);
    loadTab('wildcards');
    const w = window as any;
    if (w.toast) w.toast('Saved');
  };

  const handleWcDelete = async (name: string) => {
    if (!confirm(`Delete wildcard "${name}"?`)) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadTab('wildcards');
    const w = window as any;
    if (w.toast) w.toast('Deleted');
  };

  const handleWcCreate = async () => {
    const safe = wcNewName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!safe) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(safe)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `# ${safe} wildcard\n` }),
    });
    setWcNewName(''); setWcCreating(false);
    loadTab('wildcards');
    handleWcEdit(safe);
  };

  const handleWcExportAll = async () => {
    const r = await fetch('/api/imagegen/wildcards-export');
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wildcards-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleWcImportAll = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let data: any;
    try { data = JSON.parse(await file.text()); } catch { alert('Invalid JSON file'); return; }
    const r = await fetch('/api/imagegen/wildcards-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const w = window as any;
    if (r.ok) {
      const d = await r.json();
      if (w.toast) w.toast(`${d.created} created, ${d.updated} updated`);
      loadTab('wildcards');
    } else {
      if (w.toast) w.toast('Import failed');
    }
  };

  const openLinkSites = async () => {
    const r = await fetch('/api/websites/from-links');
    if (!r.ok) return;
    const candidates = await r.json();
    setLinkSitesCandidates(candidates);
    setLinkSitesSelected(new Set(candidates.map((c: any) => c.url)));
    setLinkSitesOpen(true);
  };

  const confirmLinkSites = async () => {
    const items = linkSitesCandidates.filter(c => linkSitesSelected.has(c.url));
    if (!items.length) { setLinkSitesOpen(false); return; }
    const r = await fetch('/api/websites/bulk-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    setLinkSitesOpen(false);
    const w = window as any;
    if (r.ok) {
      const d = await r.json();
      if (w.toast) w.toast(`Added ${d.added} website(s)`);
      loadTab('websites');
    } else {
      if (w.toast) w.toast('Failed to add websites');
    }
  };


  return (
    <div id="database-view" className="database-view on" style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>Database Management</h2>
      
      {/* Tabs + global DB buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--brd)', paddingBottom: '10px' }}>
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <input ref={importAllRef} type="file" accept=".json" title="Import full DB" style={{ display: 'none' }} onChange={handleImportAll} />
          <button className="modal-btn" onClick={handleExportAll} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '7px 14px', fontSize: '0.85rem' }}>Export DB</button>
          <button className="modal-btn" onClick={() => importAllRef.current?.click()} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '7px 14px', fontSize: '0.85rem' }}>Import DB</button>
        </div>
      </div>

      {/* Action Bar */}
      {activeTab !== 'folders' && activeTab !== 'wildcards' && (
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
          <input ref={importFileRef} type="file" accept=".json" title="Import JSON" style={{ display: 'none' }} onChange={handleImportJson} />
          <button className="modal-btn" onClick={() => { presetPickerState.value = { visible: true, mergeMode: false }; }} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Import Preset as Profile</button>
          <button className="modal-btn" onClick={handleReset} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Reset to Preset</button>
          {activeTab === 'actors' && (
            <button className="modal-btn" onClick={() => setScraperModalOpen(true)} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Scrape Actor Data</button>
          )}
          {activeTab === 'websites' && (
            <button className="modal-btn" onClick={openLinkSites} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Add from Saved Links…</button>
          )}
          <button className="modal-btn" onClick={handleExportJson} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Export JSON</button>
          <button className="modal-btn" onClick={() => importFileRef.current?.click()} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Import JSON</button>
          <button className="modal-btn" onClick={openPresetImport} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '8px 16px' }}>Import from Preset</button>
          <button className="modal-btn modal-btn--primary" onClick={() => openModal(null)}>+ Add Entry</button>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>Loading…</div>
      ) : activeTab === 'wildcards' ? (
        <div>
          {/* Wildcards toolbar */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--tx3)', flex: 1 }}>{wcList.length} wildcard{wcList.length !== 1 ? 's' : ''} in <code>db/wildcards/</code></span>
            <button className="modal-btn" onClick={() => setWcCreating(v => !v)} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '7px 14px', fontSize: '0.85rem' }}>+ New</button>
            <input ref={importWcRef} type="file" accept=".json" title="Import wildcards JSON" style={{ display: 'none' }} onChange={handleWcImportAll} />
            <button className="modal-btn" onClick={handleWcExportAll} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '7px 14px', fontSize: '0.85rem' }}>Export All</button>
            <button className="modal-btn" onClick={() => importWcRef.current?.click()} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', cursor: 'pointer', borderRadius: '4px', padding: '7px 14px', fontSize: '0.85rem' }}>Import All</button>
          </div>

          {/* New wildcard form */}
          {wcCreating && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
              <input
                value={wcNewName} autoFocus
                onInput={(e: any) => setWcNewName(e.target.value)}
                onKeyDown={(e: any) => e.key === 'Enter' && handleWcCreate()}
                placeholder="wildcard_name (letters, digits, _-)"
                style={{ flex: 1, padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', fontSize: '0.85rem' }}
              />
              <button className="modal-btn modal-btn--primary" onClick={handleWcCreate}>Create</button>
              <button className="modal-btn" onClick={() => { setWcCreating(false); setWcNewName(''); }}>Cancel</button>
            </div>
          )}

          {/* Wildcards table */}
          {wcList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>No wildcard files found in <code>db/wildcards/</code>.</div>
          ) : (
            <div style={{ border: '1px solid var(--brd)', borderRadius: '8px', overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 120px', gap: '0', background: 'var(--bg3)', padding: '8px 14px', borderBottom: '1px solid var(--brd)', fontSize: '0.75rem', color: 'var(--tx3)', fontWeight: 600 }}>
                <span>Name</span>
                <span style={{ textAlign: 'center' }}>Options</span>
                <span style={{ textAlign: 'right' }}>Actions</span>
              </div>
              {wcList.map((wc, idx) => (
                <div key={wc.name} style={{ borderBottom: idx < wcList.length - 1 ? '1px solid var(--brd)' : 'none' }}>
                  {/* Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 120px', alignItems: 'center', padding: '8px 14px', background: wcExpanded === wc.name ? 'var(--bg2)' : 'transparent' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--tx)' }}>__{wc.name}__</span>
                    <span style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--tx3)' }}>{wc.count}</span>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button onClick={() => handleWcEdit(wc.name)} style={{ background: 'none', border: '1px solid var(--brd)', color: wcExpanded === wc.name ? 'var(--ac)' : 'var(--tx3)', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer', fontSize: '0.78rem' }}>{wcExpanded === wc.name ? 'Close' : 'Edit'}</button>
                      <button onClick={() => handleWcDelete(wc.name)} style={{ background: 'none', border: '1px solid var(--brd)', color: '#c44', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.78rem' }}>✕</button>
                    </div>
                  </div>
                  {/* Inline editor */}
                  {wcExpanded === wc.name && (
                    <div style={{ padding: '0 14px 12px', background: 'var(--bg2)', borderTop: '1px solid var(--brd)' }}>
                      <textarea
                        value={wcEditContent}
                        onInput={(e: any) => setWcEditContent(e.target.value)}
                        rows={10}
                        spellcheck={false}
                        title={`Edit wildcard: ${wc.name}`}
                        style={{ width: '100%', boxSizing: 'border-box', marginTop: '10px', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                          {wcEditContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length} options
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="modal-btn" onClick={() => setWcExpanded(null)}>Cancel</button>
                          <button className="modal-btn modal-btn--primary" onClick={() => handleWcSave(wc.name)} disabled={wcEditSaving}>{wcEditSaving ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
            {/* Default write root selector */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--brd)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--ac)', marginBottom: '6px', fontWeight: 600 }}>Default path for downloads, moves, uploads &amp; new folders</div>
              <select
                value={defaultRoot}
                onChange={(e: any) => handleSetDefaultRoot(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', fontSize: '0.85rem' }}
              >
                <option value="">Main videos folder (default)</option>
                {sourceFolders.map(f => (
                  <option key={f} value={f}>{f} (external source)</option>
                ))}
              </select>
              <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '4px' }}>
                All new video files from downloads/moves/uploads and created folders will use this root. Main videos is used if none selected.
              </div>
            </div>
          </div>


          {/* Category visibility */}
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--tx3)' }}>
              {enabledFolders === null
                ? 'All folders visible (none explicitly enabled)'
                : enabledFolders.size === 0
                  ? 'No folders selected'
                  : `${folders.filter(f => enabledFolders.has(f.path)).length} of ${folders.length} folders enabled`}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="modal-btn" onClick={() => setEnabledFolders(null)}>Enable All</button>
              <button type="button" className="modal-btn" onClick={() => setEnabledFolders(new Set())}>Deselect All</button>
              <button type="button" className="modal-btn modal-btn--primary" onClick={handleSaveFolders}>Save</button>
            </div>
          </div>
          {folders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>
              No folders found in videos directory or source folders.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {folders.map(f => (
                <label key={f.path} style={{ background: 'var(--bg2)', padding: '12px', borderRadius: '8px', border: `1px solid ${f.isExternal ? 'var(--ac)' : 'var(--brd)'}`, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    title={`Enable folder ${f.name}`}
                    checked={enabledFolders === null || enabledFolders.has(f.path)}
                    onChange={(e: any) => {
                      const next = new Set(enabledFolders === null ? folders.map(fold => fold.path) : enabledFolders);
                      if (e.target.checked) next.add(f.path);
                      else next.delete(f.path);
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

      {/* Import from Preset Modal */}
      {presetImportOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '520px', maxWidth: '95%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Import from Preset</h3>
              <button type="button" onClick={() => setPresetImportOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1.3rem' }}>&times;</button>
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--tx3)' }}>Select a preset to merge its entries into your database.</p>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {presetList.map(p => (
                <div key={p.id} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tx)' }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: '0.78rem', color: 'var(--tx3)', marginTop: '2px' }}>{p.description}</div>}
                    <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '4px' }}>
                      {Object.entries(p.counts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyPresetImport(p.id)}
                    disabled={presetImporting === p.id}
                    className="modal-btn modal-btn--primary"
                    style={{ flexShrink: 0, fontSize: '0.82rem', padding: '6px 14px' }}
                  >
                    {presetImporting === p.id ? 'Importing…' : 'Import'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Websites from Links Modal */}
      {linkSitesOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '480px', maxWidth: '95%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Add websites from saved links</h3>
              <button type="button" onClick={() => setLinkSitesOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1.3rem' }}>&times;</button>
            </div>
            {linkSitesCandidates.length === 0 ? (
              <p style={{ color: 'var(--tx3)', margin: 0 }}>No new websites found — all domains from saved links are already in your list.</p>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--tx2)' }}>Select the websites to add ({linkSitesSelected.size} of {linkSitesCandidates.length} selected):</p>
                <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--tx3)', cursor: 'pointer', paddingBottom: '6px', borderBottom: '1px solid var(--brd)' }}>
                    <input type="checkbox" title="Select all websites"
                      checked={linkSitesSelected.size === linkSitesCandidates.length}
                      onChange={() => {
                        if (linkSitesSelected.size === linkSitesCandidates.length) setLinkSitesSelected(new Set());
                        else setLinkSitesSelected(new Set(linkSitesCandidates.map(c => c.url)));
                      }}
                    /> Select all
                  </label>
                  {linkSitesCandidates.map(c => (
                    <label key={c.url} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      <input type="checkbox" title={`Select ${c.name}`}
                        checked={linkSitesSelected.has(c.url)}
                        onChange={() => setLinkSitesSelected(prev => {
                          const next = new Set(prev);
                          next.has(c.url) ? next.delete(c.url) : next.add(c.url);
                          return next;
                        })}
                      />
                      <span style={{ flex: 1 }}>{c.name}</span>
                      <span style={{ color: 'var(--tx3)', fontSize: '0.75rem' }}>{c.url}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setLinkSitesOpen(false)} className="modal-btn">Cancel</button>
                  <button type="button" onClick={confirmLinkSites} disabled={linkSitesSelected.size === 0} className="modal-btn modal-btn--primary">Add {linkSitesSelected.size} website{linkSitesSelected.size !== 1 ? 's' : ''}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
