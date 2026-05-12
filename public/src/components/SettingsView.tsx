import { appPrefs, updatePrefs } from '../store';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PERSONALITIES, Personality } from '../personalities';

export const SettingsView = () => {
  const prefs = appPrefs.value;

  const [commentPrompt, setCommentPrompt] = useState(prefs.aiCommentMasterPrompt || '');
  const [replyPrompt, setReplyPrompt] = useState(prefs.aiReplyMasterPrompt || '');
  const [ollamaUrl, setOllamaUrl] = useState(prefs.ollamaUrl || '');
  const [ollamaModel, setOllamaModel] = useState(prefs.ollamaVisionModel || '');
  const [anthropicKey, setAnthropicKey] = useState(prefs.anthropicApiKey || '');
  const [hiddenCats, setHiddenCats] = useState('');
  
  const [connectUrls, setConnectUrls] = useState<any[]>([]);
  const [connectIdx, setConnectIdx] = useState(0);
  const [netEnabled, setNetEnabled] = useState(!!prefs.networkEnabled);
  
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setCommentPrompt(prefs.aiCommentMasterPrompt || '');
    setReplyPrompt(prefs.aiReplyMasterPrompt || '');
    setOllamaUrl(prefs.ollamaUrl || '');
    setOllamaModel(prefs.ollamaVisionModel || '');
    setAnthropicKey(prefs.anthropicApiKey || '');
    setNetEnabled(!!prefs.networkEnabled);
  }, [prefs]);

  useEffect(() => {
    // Load hidden categories
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(data => setHiddenCats(data.hidden || ''))
      .catch(() => {});
      
    // Load network info if enabled
    if (prefs.networkEnabled) {
      fetch('/api/local-ip')
        .then(r => r.json())
        .then(data => {
          if (data.url) {
            setConnectUrls(data.all && data.all.length ? data.all : [{ url: data.url, name: 'Network', ip: data.ip }]);
          }
        })
        .catch(() => {});
    }
  }, [prefs.networkEnabled]);

  useEffect(() => {
    if (qrRef.current && connectUrls.length > 0) {
      const url = connectUrls[connectIdx]?.url;
      if (url && (window as any).QRCode) {
        (window as any).QRCode.toCanvas(qrRef.current, url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
      }
    }
  }, [connectUrls, connectIdx]);

  const applyPersonality = (p: Personality) => {
    setCommentPrompt(p.prompt);
    setReplyPrompt(p.replyPrompt);
  };

  const handleSaveAi = () => {
    updatePrefs({
      aiCommentMasterPrompt: commentPrompt,
      aiReplyMasterPrompt: replyPrompt
    });
    alert('AI Prompts saved!');
  };

  const handleSaveOllama = () => {
    updatePrefs({
      ollamaUrl: ollamaUrl,
      ollamaVisionModel: ollamaModel
    });
    alert('Ollama settings saved!');
  };

  const handleSaveAnthropic = () => {
    updatePrefs({
      anthropicApiKey: anthropicKey
    });
    alert('Anthropic API key saved!');
  };

  const handleSaveHidden = async () => {
    const r = await fetch('/api/settings/hidden', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: hiddenCats })
    });
    if (r.ok) alert('Hidden categories saved!');
    else alert('Save failed');
  };

  const toggleNetwork = async () => {
    const newVal = !netEnabled;
    setNetEnabled(newVal);
    updatePrefs({ networkEnabled: newVal });
  };

  const isMainDevice = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  return (
    <div className="settings-view" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', color: 'var(--tx)' }}>
      <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <i className="icon-settings" style={{ color: 'var(--ac)' }} />
        Settings
      </h2>
      
      {/* AI Comments Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="icon-message-square" />
            AI Comments
          </h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={!!prefs.aiCommentsEnabled}
              onChange={(e) => updatePrefs({ aiCommentsEnabled: (e.currentTarget as HTMLInputElement).checked })}
              style={{ width: '18px', height: '18px' }}
            />
            Enable AI comments
          </label>
        </div>

        {/* Personality Preset */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Preset Personality</label>
          <select 
            onChange={(e: any) => {
              const p = PERSONALITIES.find(x => x.id === e.target.value);
              if (p) applyPersonality(p);
            }}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          >
            <option value="">-- Select a preset personality --</option>
            {PERSONALITIES.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Prompts */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Comment Master Prompt</label>
          <textarea 
            value={commentPrompt}
            onInput={(e: any) => setCommentPrompt(e.target.value)}
            rows={4}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace' }}
          />
        </div>
        
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Reply Master Prompt</label>
          <textarea 
            value={replyPrompt}
            onInput={(e: any) => setReplyPrompt(e.target.value)}
            rows={3}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace' }}
          />
        </div>

        <button class="modal-btn modal-btn--primary" onClick={handleSaveAi} style={{ width: '100%' }}>Save Prompts</button>
      </div>

      {/* Vision Provider Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Vision Provider</h3>
        
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Provider</label>
          <select 
            value={prefs.visionProvider || 'ollama'}
            onChange={(e: any) => updatePrefs({ visionProvider: e.target.value })}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          >
            <option value="ollama">Ollama (Local)</option>
            <option value="claude">Claude (Anthropic)</option>
          </select>
        </div>

        {prefs.visionProvider === 'ollama' || !prefs.visionProvider ? (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Ollama URL</label>
              <input type="text" value={ollamaUrl} onInput={(e: any) => setOllamaUrl(e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Vision Model</label>
              <input type="text" value={ollamaModel} onInput={(e: any) => setOllamaModel(e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <button class="modal-btn modal-btn--primary" onClick={handleSaveOllama} style={{ width: '100%' }}>Save Ollama Settings</button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Anthropic API Key</label>
              <input type="password" value={anthropicKey} onInput={(e: any) => setAnthropicKey(e.target.value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <button class="modal-btn modal-btn--primary" onClick={handleSaveAnthropic} style={{ width: '100%' }}>Save API Key</button>
          </>
        )}
      </div>

      {/* Hidden Categories Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Hidden Categories</h3>
        <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>Enter folder names to hide, one per line.</p>
        <textarea 
          value={hiddenCats}
          onInput={(e: any) => setHiddenCats(e.target.value)}
          rows={5}
          style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace', marginBottom: '16px' }}
        />
        <button class="modal-btn modal-btn--primary" onClick={handleSaveHidden} style={{ width: '100%' }}>Save Hidden Categories</button>
      </div>

      {/* Network & Remote Section */}
      {isMainDevice && (
        <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)' }}>
          <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Network Access</h3>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>{netEnabled ? 'Enabled' : 'Disabled'}</div>
              <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>
                {netEnabled ? 'Other devices on the network can connect' : 'Server only accepts connections from this machine'}
              </div>
            </div>
            <button class={`modal-btn ${netEnabled ? 'modal-btn--primary' : ''}`} onClick={toggleNetwork}>
              {netEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {netEnabled && connectUrls.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '5px' }}>
                {connectUrls.map((e, i) => (
                  <button 
                    key={i}
                    onClick={() => setConnectIdx(i)}
                    style={{ 
                      padding: '4px 10px', 
                      borderRadius: '999px', 
                      fontSize: '0.75rem', 
                      border: '1px solid var(--brd)',
                      background: i === connectIdx ? 'var(--ac)' : 'var(--bg3)',
                      color: i === connectIdx ? '#fff' : 'var(--tx2)'
                    }}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--tx2)' }}>{connectUrls[connectIdx]?.url}</div>
              <canvas ref={qrRef} style={{ background: '#fff', padding: '10px', borderRadius: '8px' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
