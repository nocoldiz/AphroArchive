import { useState, useEffect, useRef } from 'preact/hooks';
import { dialogState, settleDialog } from '../../dialog';

// Renders the active promise-based dialog (alert / confirm / prompt) as an
// in-app modal. Mounted once, globally; driven entirely by dialogState.
export const DialogModal = () => {
  const state = dialogState.value;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      setValue(state.defaultValue);
      // Focus after paint so the input/select is ready.
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    }
  }, [state.visible, state.defaultValue]);

  if (!state.visible) return null;

  const isPrompt = state.kind === 'prompt';
  const isAlert = state.kind === 'alert';

  const onConfirm = () => settleDialog(isPrompt ? value : true);
  const onCancel = () => settleDialog(isPrompt ? null : false);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  return (
    <div
      className="modal-overlay on"
      onClick={(e: any) => e.target === e.currentTarget && onCancel()}
      onKeyDown={onKeyDown as any}
      style={{ zIndex: 30000 }}
    >
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', width: '400px', maxWidth: '92vw' }}>
        {state.title && <h3 style={{ marginTop: 0, marginBottom: '10px' }}>{state.title}</h3>}
        {state.message && (
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--tx2)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: isPrompt ? '12px' : '18px' }}>
            {state.message}
          </div>
        )}
        {isPrompt && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={state.placeholder}
            onInput={(e: any) => setValue(e.target.value)}
            onKeyDown={onKeyDown as any}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', marginBottom: '16px' }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {!isAlert && (
            <button
              onClick={onCancel}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 14px', borderRadius: '4px', cursor: 'pointer' }}
            >
              {state.cancelLabel}
            </button>
          )}
          <button
            ref={!isPrompt ? (inputRef as any) : undefined}
            onClick={onConfirm}
            style={{ background: state.danger ? '#e84040' : 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
