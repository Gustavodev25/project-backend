import { ReactNode } from 'react';

// Force dynamic rendering - configurações mais agressivas
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <title>ContaZoom API</title>
        <meta name="description" content="Backend API" />
      </head>
      <body>{children}</body>
    </html>
  );
}
