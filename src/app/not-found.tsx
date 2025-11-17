// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;

export default function NotFound() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>404 - Página não encontrada</h1>
      <p>A rota que você está procurando não existe.</p>
    </div>
  );
}
