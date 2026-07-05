import { signal } from '@preact/signals';

// ─── Promise-based dialogs ───────────────────────────────────────────
// Drop-in async replacements for the native alert()/confirm()/prompt()
// popups so every confirmation renders as an in-app modal instead of a
// browser chrome dialog. Call sites become:
//   if (!await confirmDialog('Delete?')) return;
//   const name = await promptDialog('New name:', current);
//   await alertDialog('Something went wrong');

export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogState {
  visible: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  defaultValue: string;
  placeholder: string;
}

const initial: DialogState = {
  visible: false, kind: 'alert', title: '', message: '',
  confirmLabel: 'OK', cancelLabel: 'Cancel', danger: false,
  defaultValue: '', placeholder: '',
};

export const dialogState = signal<DialogState>(initial);

// Resolver for the currently-open dialog; settled by the modal's buttons.
let resolver: ((value: any) => void) | null = null;

function open(partial: Partial<DialogState>): Promise<any> {
  // If a dialog is already open, resolve it as cancelled before replacing it.
  if (resolver) { resolver(dialogState.value.kind === 'prompt' ? null : false); resolver = null; }
  dialogState.value = { ...initial, visible: true, ...partial };
  return new Promise(res => { resolver = res; });
}

export function settleDialog(value: any) {
  dialogState.value = { ...dialogState.value, visible: false };
  const r = resolver;
  resolver = null;
  if (r) r(value);
}

interface ConfirmOpts { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; }
interface PromptOpts { title?: string; confirmLabel?: string; placeholder?: string; }

export function confirmDialog(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return open({
    kind: 'confirm', message,
    title: opts.title ?? 'Confirm',
    confirmLabel: opts.confirmLabel ?? 'OK',
    cancelLabel: opts.cancelLabel ?? 'Cancel',
    danger: opts.danger ?? /delete|remove|permanent|shred|wipe|destroy|clear/i.test(message),
  });
}

export function promptDialog(message: string, defaultValue = '', opts: PromptOpts = {}): Promise<string | null> {
  return open({
    kind: 'prompt', message,
    title: opts.title ?? 'Enter a value',
    confirmLabel: opts.confirmLabel ?? 'OK',
    defaultValue: defaultValue ?? '',
    placeholder: opts.placeholder ?? '',
  });
}

export function alertDialog(message: string, opts: { title?: string } = {}): Promise<void> {
  return open({ kind: 'alert', message, title: opts.title ?? 'Notice', confirmLabel: 'OK' }).then(() => undefined);
}

if (typeof window !== 'undefined') {
  (window as any).confirmDialog = confirmDialog;
  (window as any).promptDialog = promptDialog;
  (window as any).alertDialog = alertDialog;
}
