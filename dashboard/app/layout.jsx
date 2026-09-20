import './globals.css';

export const metadata = { title: 'ODIN' };

export default function Layout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
