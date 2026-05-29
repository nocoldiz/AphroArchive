import { useEffect, useState } from 'preact/hooks';

export const GlobalDownloadBar = () => {
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => {
    let timer = setInterval(async () => {
      try {
        const r = await fetch('/api/download/jobs');
        if (r.ok) {
          const data = await r.json();
          // Show queued, running, or recently done/error jobs if needed.
          // For simplicity, we just show active ones.
          const activeJobs = data.filter((j: any) => j.status === 'running' || j.status === 'queued');
          setJobs(activeJobs);
        }
      } catch (e) {}
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (jobs.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      background: 'var(--bg2, rgba(0, 0, 0, 0.85))',
      backdropFilter: 'blur(10px)',
      border: '1px solid var(--brd, rgba(255, 255, 255, 0.1))',
      borderRadius: '12px',
      padding: '15px',
      width: '320px',
      zIndex: 10000,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      color: 'var(--tx, #fff)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      <h4 style={{ margin: 0, fontSize: '1rem', borderBottom: '1px solid var(--brd, rgba(255,255,255,0.1))', paddingBottom: '8px' }}>
        Downloads ({jobs.length})
      </h4>
      <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {jobs.map(job => (
          <div key={job.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={job.title}>
                {job.title || 'Video'}
              </span>
              <span>{job.status === 'running' ? `${(job.progress || 0).toFixed(1)}%` : 'Queued'}</span>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'var(--bg3, rgba(255,255,255,0.1))', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${job.progress || 0}%`, 
                height: '100%', 
                background: job.status === 'running' ? 'var(--ac, #ff7300)' : '#888',
                transition: 'width 0.3s ease'
              }} />
            </div>
            {job.status === 'running' && job.speed && (
              <div style={{ fontSize: '0.75rem', color: 'var(--tx3, #888)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{job.speed}</span>
                <span>{job.eta && `ETA ${job.eta}`}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
