import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PartyPayday — split any bill, fairly',
  description:
    'Add people, add expenses, pick who shares what. PartyPayday works out who owes whom and shows the full proof so nobody argues.',
  applicationName: 'PartyPayday',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'PartyPayday' },
  openGraph: {
    title: 'PartyPayday — split any bill, fairly',
    description: 'Who owes whom, with the math laid out so nobody argues.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#090a0e',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
