import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Kings Research – Translation & Live URL Verification',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
