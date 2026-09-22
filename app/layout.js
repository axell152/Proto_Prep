import './globals.css';

export const metadata = {
  title: 'Prépa Commandes',
  description: 'Prototype de préparation de commandes'
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
