import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BrosPayday — split any bill, fairly',
  description:
    'Add people, add expenses, pick who shares what. BrosPayday works out who owes whom and shows the full proof so nobody argues.',
  applicationName: 'BrosPayday',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BrosPayday' },
  openGraph: {
    title: 'BrosPayday — split any bill, fairly',
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
  // Android shrinks the page for the keyboard rather than drawing over it, which
  // is what keeps a sheet's buttons reachable while typing.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
