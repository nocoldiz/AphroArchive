// Quick Links widget — shortcut cards into every section.
import { favFilter, showConnectModal } from '../../public/src/store';
import { WidgetShell, nav } from '../../public/src/home/shared';

const Card = ({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) => (
  <button className="dw-ql-card" onClick={onClick}>
    <div className="dw-ql-name">{label}</div>
    <div className="dw-ql-desc">{desc}</div>
  </button>
);

export default function QuickLinksWidget() {
  return (
    <WidgetShell title="Quick Links">
      <div className="dw-ql-grid">
        <Card label="Favourites" desc="Your starred videos" onClick={() => { favFilter.value = true; nav('browse'); }} />
        <Card label="Playlists" desc="Saved video groups" onClick={() => nav('collections', '/collections')} />
        <Card label="Vault" desc="Encrypted storage" onClick={() => nav('vault', '/vault')} />
        <Card label="Folders" desc="Browse by folder" onClick={() => nav('categories', '/categories')} />
        <Card label="Actors" desc="Actor database" onClick={() => nav('actors', '/actors')} />
        <Card label="Studios" desc="Studio database" onClick={() => nav('studios', '/studios')} />
        <Card label="Photos" desc="Photo gallery" onClick={() => nav('photos', '/photos')} />
        <Card label="Audio" desc="Music player" onClick={() => nav('audio', '/audio')} />
        <Card label="Books" desc="E-book reader" onClick={() => nav('books', '/books')} />
        <Card label="Links" desc="Imported bookmarks" onClick={() => nav('links', '/links')} />
        <Card label="Database" desc="Edit metadata" onClick={() => nav('database', '/database')} />
        <Card label="Connect" desc="Remote via QR" onClick={() => { showConnectModal.value = true; }} />
        <Card label="Settings" desc="Preferences" onClick={() => nav('settings', '/settings')} />
      </div>
    </WidgetShell>
  );
}
