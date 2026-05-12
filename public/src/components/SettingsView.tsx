import { appPrefs, updatePrefs } from '../store';
import { useState, useEffect } from 'preact/hooks';
import { PERSONALITIES, Personality } from '../personalities';

export const SettingsView = () => {
  const [commentPrompt, setCommentPrompt] = useState(appPrefs.value.aiCommentMasterPrompt || '');
  const [replyPrompt, setReplyPrompt] = useState(appPrefs.value.aiReplyMasterPrompt || '');

  useEffect(() => {
    if (!commentPrompt) setCommentPrompt(appPrefs.value.aiCommentMasterPrompt || '');
    if (!replyPrompt) setReplyPrompt(appPrefs.value.aiReplyMasterPrompt || '');
  }, [appPrefs.value]);

  const applyPersonality = (p: Personality) => {
    setCommentPrompt(p.prompt);
    setReplyPrompt(p.replyPrompt);
  };

  const handleSave = () => {
    updatePrefs({
      aiCommentMasterPrompt: commentPrompt,
      aiReplyMasterPrompt: replyPrompt
    });
    alert('Settings saved!');
  };

  return (
    <div className="settings-view" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', color: 'var(--tx)' }}>
      <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <i className="icon-settings" style={{ color: 'var(--ac)' }} />
        Settings
      </h2>
      
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
            AI Comments (node-llama-cpp)
          </h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            <input 
              type="checkbox" 
              checked={!!appPrefs.value.aiCommentsEnabled}
              onChange={(e) => updatePrefs({ aiCommentsEnabled: (e.currentTarget as HTMLInputElement).checked })}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--ac)' }}
            />
            Enable AI comments
          </label>
        </div>

        <div style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg3)', borderRadius: '8px', border: '1px solid var(--brd)' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold', color: 'var(--tx2)' }}>
            Preset Personality
          </label>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <select 
              onChange={(e: any) => {
                const p = PERSONALITIES.find(x => x.id === e.target.value);
                if (p) applyPersonality(p);
              }}
              style={{ 
                flex: 1,
                background: 'var(--bg2)', 
                color: 'var(--tx)', 
                border: '1px solid var(--brd)', 
                borderRadius: '6px', 
                padding: '10px 12px',
                fontSize: '14px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="">-- Select a preset personality --</option>
              {PERSONALITIES.map(p => (
                <option key={p.id} value={p.id}>{p.name} — {p.description}</option>
              ))}
            </select>
            <div style={{ fontSize: '12px', color: 'var(--tx3)', maxWidth: '200px' }}>
              Selecting a preset will overwrite the custom prompts below.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            Main Comments Master Prompt
          </label>
          <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>
            Use <code>{"{count}"}</code> and <code>{"{videoName}"}</code> as placeholders.
          </p>
          <textarea 
            value={commentPrompt}
            onInput={(e: any) => setCommentPrompt(e.target.value)}
            rows={6}
            placeholder="Enter the master prompt for comment generation..."
            style={{ 
              width: '100%', 
              background: 'var(--bg3)', 
              color: 'var(--tx)', 
              border: '1px solid var(--brd)', 
              borderRadius: '8px', 
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              resize: 'vertical',
              outline: 'none'
            }}
            onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--ac)'}
            onBlur={(e) => (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--brd)'}
          />
        </div>

        <div style={{ marginBottom: '32px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            AI Reply Master Prompt
          </label>
          <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>
            Use <code>{"{userComment}"}</code> and <code>{"{videoName}"}</code> as placeholders.
          </p>
          <textarea 
            value={replyPrompt}
            onInput={(e: any) => setReplyPrompt(e.target.value)}
            rows={4}
            placeholder="Enter the master prompt for AI replies..."
            style={{ 
              width: '100%', 
              background: 'var(--bg3)', 
              color: 'var(--tx)', 
              border: '1px solid var(--brd)', 
              borderRadius: '8px', 
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              resize: 'vertical',
              outline: 'none'
            }}
            onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--ac)'}
            onBlur={(e) => (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--brd)'}
          />
        </div>

        <button 
          onClick={handleSave}
          style={{ 
            background: 'var(--ac)', 
            color: '#fff', 
            border: 'none', 
            padding: '14px 32px', 
            borderRadius: '8px', 
            fontWeight: 'bold', 
            cursor: 'pointer',
            width: '100%',
            fontSize: '16px',
            transition: 'opacity 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          Save AI Comment Settings
        </button>
      </div>
    </div>
  );
};
