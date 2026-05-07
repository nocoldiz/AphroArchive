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
    <div className="settings-view" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '20px' }}>Settings</h2>
      
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', border: '1px solid var(--brd)' }}>
        <h3 style={{ marginBottom: '8px', color: 'var(--ac)' }}>AI Comment Personalities</h3>
        <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '16px' }}>Select a preset to load its prompt, then customize it below.</p>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '24px' }}>
          {PERSONALITIES.map(p => (
            <div 
              key={p.id} 
              onClick={() => applyPersonality(p)}
              style={{ 
                padding: '12px', 
                background: 'var(--bg3)', 
                border: '1px solid var(--brd)', 
                borderRadius: '8px', 
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--ac)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--brd)'}
            >
              <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{p.name}</div>
              <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>{p.description}</div>
            </div>
          ))}
        </div>

        <h3 style={{ marginBottom: '16px', color: 'var(--ac)' }}>Custom Master Prompts</h3>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            Main Comments Prompt
          </label>
          <textarea 
            value={commentPrompt}
            onInput={(e: any) => setCommentPrompt(e.target.value)}
            rows={5}
            style={{ 
              width: '100%', 
              background: 'var(--bg3)', 
              color: 'var(--tx)', 
              border: '1px solid var(--brd)', 
              borderRadius: '6px', 
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '13px'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            AI Reply Prompt
          </label>
          <textarea 
            value={replyPrompt}
            onInput={(e: any) => setReplyPrompt(e.target.value)}
            rows={3}
            style={{ 
              width: '100%', 
              background: 'var(--bg3)', 
              color: 'var(--tx)', 
              border: '1px solid var(--brd)', 
              borderRadius: '6px', 
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '13px'
            }}
          />
        </div>

        <button 
          onClick={handleSave}
          style={{ 
            background: 'var(--ac)', 
            color: '#fff', 
            border: 'none', 
            padding: '12px 32px', 
            borderRadius: '6px', 
            fontWeight: 'bold', 
            cursor: 'pointer',
            width: '100%'
          }}
        >
          Save All Settings
        </button>
      </div>
    </div>
  );
};
