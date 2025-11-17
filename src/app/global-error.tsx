'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
          <h1>Erro Global</h1>
          <p>Algo deu errado: {error.message}</p>
          <button onClick={() => reset()}>Tentar novamente</button>
        </div>
      </body>
    </html>
  );
}
