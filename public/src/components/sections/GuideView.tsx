const Section = ({ title, children }: { title: string; children: any }) => (
  <div style={{ marginBottom: '32px' }}>
    <h2 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--tx3)', marginBottom: '10px', fontWeight: 600 }}>{title}</h2>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const Row = ({ keys, action }: { keys: string | string[]; action: string }) => {
  const ks = Array.isArray(keys) ? keys : [keys];
  return (
    <tr style={{ borderBottom: '1px solid var(--brd)' }}>
      <td style={{ padding: '9px 0', width: '200px', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {ks.map((k, i) => (
            <kbd key={i} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '5px', background: 'var(--bg3)', border: '1px solid var(--brd)', fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--tx)', lineHeight: 1.6 }}>{k}</kbd>
          ))}
        </div>
      </td>
      <td style={{ padding: '9px 0 9px 20px', fontSize: '0.88rem', color: 'var(--tx2)', verticalAlign: 'middle' }}>{action}</td>
    </tr>
  );
};

export const GuideView = () => (
  <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px' }}>
    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '6px' }}>Keyboard Shortcuts</h1>
    <p style={{ color: 'var(--tx3)', fontSize: '0.88rem', marginBottom: '36px' }}>Shortcuts are active when the focus is not inside a text input.</p>

    <Section title="Playback">
      <Row keys="Space" action="Play / Pause" />
      <Row keys={['←', '→']} action="Seek ±10 s (hold to ramp up to ±40 s)" />
      <Row keys={['Shift + ←', 'Shift + →']} action="Jump to previous / next chapter" />
      <Row keys={['↑', '↓']} action="Volume +10 % / −10 %" />
      <Row keys="M" action="Toggle mute" />
      <Row keys="F" action="Toggle fullscreen" />
      <Row keys="C" action="Toggle subtitle track on / off" />
      <Row keys="N" action="Next video" />
      <Row keys="P" action="Previous video" />
    </Section>

    <Section title="Library">
      <Row keys="V" action="Toggle favourite (while video is open)" />
    </Section>

    <Section title="Player controls (on screen)">
      <Row keys="A / B" action="Set A/B loop start / end point" />
      <Row keys="⚡" action="Local Zap mode — random seek every 5 s" />
      <Row keys="SUB" action="Open subtitle track picker" />
      <Row keys="CC" action="Toggle subtitles on / off (only shown when subs are available)" />
      <Row keys="HLS" action="Switch to HLS transcode stream (for unsupported formats)" />
    </Section>

    <Section title="Chapter markers in timeline">
      <Row keys="White line" action="Manual chapter" />
      <Row keys="Cyan line" action="Auto-detected scene (requires scene detection enabled)" />
      <Row keys="Green / Red line" action="A / B loop points" />
    </Section>
  </div>
);
