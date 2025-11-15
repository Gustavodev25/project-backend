import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import { getBlingCategorias, refreshBlingAccountToken } from "@/lib/bling";

export const runtime = "nodejs";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }
    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ error: "Sessao invalida ou expirada" }, { status: 401 });
    }
    const userId = session.sub;

    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId, expires_at: { gt: new Date() } },
    });
    if (!blingAccount) {
      return NextResponse.json({ error: "Nenhuma conta Bling ativa" }, { status: 404 });
    }
    const acc = await refreshBlingAccountToken(blingAccount).catch(() => blingAccount);

    const categorias = await getBlingCategorias(acc.access_token).catch(() => [] as any[]);
    const map = new Map<string, string>();
    for (const c of categorias || []) {
      const id = (c?.id ?? c?.idCategoria ?? c?.codigo)?.toString?.();
      const name = c?.nome ?? c?.descricao;
      if (id && name) map.set(id, String(name));
    }
    if (map.size === 0) {
      return NextResponse.json({ updated: 0, reason: "map vazio" });
    }

    let updated = 0;
    // Atualiza nomes "Categoria" por nomes reais quando houver blingId e no mapa
    const toFix = await prisma.categoria.findMany({
      where: { userId, nome: "Categoria", blingId: { not: null } },
      select: { id: true, blingId: true },
    });
    for (const row of toFix) {
      const key = String(row.blingId);
      const name = map.get(key);
      if (!name) continue;
      try {
        await prisma.categoria.update({ where: { id: row.id }, data: { nome: name, descricao: name } });
        updated += 1;
      } catch {}
    }

    return NextResponse.json({ updated, total: map.size });
  } catch (e) {
    console.error("Erro ao reparar categorias:", e);
    return NextResponse.json({ error: "Erro ao reparar categorias" }, { status: 500 });
  }
}

