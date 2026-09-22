import Link from 'next/link';

export default function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'white' }}>
          PRÉPA <span>COMMANDES</span>
        </Link>
        <nav className="nav">
          <Link href="/">Commandes</Link>
          <Link href="/admin">Importer un bon</Link>
        </nav>
      </div>
    </header>
  );
}
