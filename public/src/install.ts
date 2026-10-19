// Linking an existing installation on disk (see server/install-server.js).
// Link / unlink restart the server; the page waits for it and reloads.

export interface InstallStatus {
  linked: boolean; installDir: string; appDir: string; dataDir: string;
  dbDir: string; mediaDir: string; canRestart: boolean;
}

export interface InstallCheck { valid: boolean; reason?: string; path?: string; dbFile?: string; mediaDir?: string }

export const getInstallStatus = async (): Promise<InstallStatus> => (await fetch('/api/install')).json();

export const checkInstall = async (dir: string): Promise<InstallCheck> =>
  (await fetch('/api/install/check?path=' + encodeURIComponent(dir))).json();

const post = async (url: string, body?: unknown) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

// Poll until the restarted server answers with the expected link state, then reload.
const waitAndReload = async (expectLinked: boolean) => {
  await new Promise(r => setTimeout(r, 1500));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await getInstallStatus();
      if (s.linked === expectLinked) { window.location.href = '/'; return; }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('The server did not come back. Restart AphroArchive manually.');
};

export const linkInstall = async (dir: string) => {
  const d = await post('/api/install/link', { path: dir });
  if (d.restarting) await waitAndReload(d.linked);
  return d;
};

export const unlinkInstall = async () => {
  const d = await post('/api/install/unlink');
  if (d.restarting) await waitAndReload(false);
  return d;
};
