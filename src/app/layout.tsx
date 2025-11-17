import { ReactNode } from 'react';

export const metadata = {
  title: 'ContaZoom API',
  description: 'Backend API',
};

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
