import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // Evita cache estático

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    const body = await request.json();
    const { descricao, tipo, categoriaPaiId } = body;

    if (!descricao || !tipo) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Se categoriaPaiId for fornecido, validar que existe
    if (categoriaPaiId) {
      const categoriaPai = await prisma.categoria.findFirst({
        where: {
          id: categoriaPaiId,
          userId: userId,
        },
      });

      if (!categoriaPai) {
        return NextResponse.json(
          { error: "Categoria pai não encontrada" },
          { status: 404 }
        );
      }
    }

    const categoria = await prisma.categoria.create({
      data: {
        userId: userId,
        nome: descricao,
        descricao: descricao,
        tipo: tipo,
        categoriaPaiId: categoriaPaiId || null,
        ativo: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: categoria,
    });
  } catch (error) {
    console.error("Erro ao criar categoria:", error);
    return NextResponse.json(
      { error: "Erro ao criar categoria" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  console.log('[Categorias GET] === INÍCIO DA REQUISIÇÃO ===');
  console.log('[Categorias GET] Runtime:', process.env.VERCEL ? 'VERCEL' : 'LOCAL');
  
  try {
    // STEP 1: Cookies
    console.log('[Categorias GET] STEP 1: Obtendo cookies...');
    let cookieStore;
    try {
      cookieStore = await cookies();
      console.log('[Categorias GET] ✅ Cookies obtidos com sucesso');
    } catch (cookieError) {
      console.error('[Categorias GET] ❌ ERRO ao obter cookies:', cookieError);
      throw new Error(`Erro ao obter cookies: ${cookieError}`);
    }
    
    // STEP 2: Session Cookie
    console.log('[Categorias GET] STEP 2: Buscando session cookie...');
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      console.log('[Categorias GET] ❌ Não autenticado - sem cookie de sessão');
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.log('[Categorias GET] ✅ Cookie de sessão encontrado');

    // STEP 3: Verify Token
    console.log('[Categorias GET] STEP 3: Verificando token...');
    let session;
    try {
      session = await tryVerifySessionToken(sessionCookie.value);
      console.log('[Categorias GET] ✅ Token verificado com sucesso');
    } catch (tokenError) {
      console.error('[Categorias GET] ❌ ERRO ao verificar token:', tokenError);
      throw new Error(`Erro ao verificar token: ${tokenError}`);
    }
    
    if (!session) {
      console.log('[Categorias GET] ❌ Sessão inválida');
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    console.log(`[Categorias GET] ✅ UserId obtido: ${userId}`);

    // FAST PATH: Consulta otimizada em única query (inclui subcategorias)
    try {
      const categoriasFast = await prisma.categoria.findMany({
        where: { userId },
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          userId: true,
          blingId: true,
          nome: true,
          descricao: true,
          tipo: true,
          ativo: true,
          categoriaPaiId: true,
          sincronizadoEm: true,
          atualizadoEm: true,
          subCategorias: {
            orderBy: { nome: 'asc' },
            select: {
              id: true,
              userId: true,
              blingId: true,
              nome: true,
              descricao: true,
              tipo: true,
              ativo: true,
              categoriaPaiId: true,
              sincronizadoEm: true,
              atualizadoEm: true,
            },
          },
        },
      });
      const payload = categoriasFast.map((c: any) => ({ ...c, categoriaPai: null }));
      return NextResponse.json({ success: true, data: payload });
    } catch (fastErr) {
      console.warn('[Categorias GET] Aviso: fallback para caminho antigo devido a erro na consulta otimizada:', fastErr);
    }

    // STEP 4: Query Categorias
    console.log('[Categorias GET] STEP 4: Buscando categorias no banco...');
    let categorias;
    try {
      categorias = await prisma.categoria.findMany({
        where: {
          userId: userId,
          // Removido filtro ativo: true para mostrar todas as categorias (inclusive inativas)
          // Categorias inativas ainda podem estar em uso por contas antigas
        },
        orderBy: {
          nome: "asc",
        },
      });
      console.log(`[Categorias GET] ✅ ${categorias.length} categorias encontradas`);
    } catch (dbError) {
      console.error('[Categorias GET] ❌ ERRO ao buscar categorias:', dbError);
      throw new Error(`Erro no banco de dados (categorias): ${dbError}`);
    }

    // STEP 5: Query Subcategorias
    console.log('[Categorias GET] STEP 5: Buscando subcategorias...');
    const categoriaIds = categorias.map((c) => c.id);
    let subCategorias = [] as typeof categorias;
    
    if (categoriaIds.length > 0) {
      try {
        subCategorias = await prisma.categoria.findMany({
          where: {
            categoriaPaiId: { in: categoriaIds },
            // Removido filtro ativo: true para mostrar todas as subcategorias
          },
          orderBy: {
            nome: "asc",
          },
        });
        console.log(`[Categorias GET] ✅ ${subCategorias.length} subcategorias encontradas`);
      } catch (subDbError) {
        console.error('[Categorias GET] ❌ ERRO ao buscar subcategorias:', subDbError);
        throw new Error(`Erro no banco de dados (subcategorias): ${subDbError}`);
      }
    } else {
      console.log('[Categorias GET] ⚠️ Nenhuma categoria pai, pulando subcategorias');
    }

    // STEP 6: Montar Estrutura
    console.log('[Categorias GET] STEP 6: Montando estrutura de dados...');
    let categoriasComSubs;
    try {
      categoriasComSubs = categorias.map(cat => ({
        ...cat,
        subCategorias: subCategorias.filter(sub => sub.categoriaPaiId === cat.id),
        categoriaPai: null,
      }));
      console.log(`[Categorias GET] ✅ Estrutura montada: ${categoriasComSubs.length} categorias`);
    } catch (mapError) {
      console.error('[Categorias GET] ❌ ERRO ao montar estrutura:', mapError);
      throw new Error(`Erro ao processar dados: ${mapError}`);
    }

    // STEP 7: Return Response
    console.log('[Categorias GET] STEP 7: Preparando resposta...');
    console.log('[Categorias GET] === REQUISIÇÃO CONCLUÍDA COM SUCESSO ===');
    
    return NextResponse.json({
      success: true,
      data: categoriasComSubs,
    });
    
  } catch (error) {
    console.error("[Categorias GET] ========================================");
    console.error("[Categorias GET] ❌❌❌ ERRO CRÍTICO CAPTURADO ❌❌❌");
    console.error("[Categorias GET] ========================================");
    console.error("[Categorias GET] Tipo do erro:", typeof error);
    console.error("[Categorias GET] Nome do erro:", error instanceof Error ? error.name : 'Unknown');
    console.error("[Categorias GET] Mensagem:", error instanceof Error ? error.message : String(error));
    console.error("[Categorias GET] Stack trace:", error instanceof Error ? error.stack : 'N/A');
    console.error("[Categorias GET] Erro completo:", JSON.stringify(error, null, 2));
    console.error("[Categorias GET] ========================================");
    
    return NextResponse.json(
      { 
        error: "Erro ao buscar categorias",
        details: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.name : typeof error
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();
    const body = await request.json();
    const { descricao, tipo, categoriaPaiId } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID do registro não fornecido" },
        { status: 400 }
      );
    }

    if (!descricao || !tipo) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const categoria = await prisma.categoria.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!categoria) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Se categoriaPaiId for fornecido, validar que existe e não é a própria categoria
    if (categoriaPaiId) {
      if (categoriaPaiId === id) {
        return NextResponse.json(
          { error: "Uma categoria não pode ser pai de si mesma" },
          { status: 400 }
        );
      }

      const categoriaPai = await prisma.categoria.findFirst({
        where: {
          id: categoriaPaiId,
          userId: userId,
        },
      });

      if (!categoriaPai) {
        return NextResponse.json(
          { error: "Categoria pai não encontrada" },
          { status: 404 }
        );
      }
    }

    // Atualizar o registro
    const categoriaAtualizada = await prisma.categoria.update({
      where: {
        id: id,
      },
      data: {
        descricao,
        tipo,
        categoriaPaiId: categoriaPaiId || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: categoriaAtualizada,
    });
  } catch (error) {
    console.error("Erro ao atualizar categoria:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar categoria" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID do registro não fornecido" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const categoria = await prisma.categoria.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!categoria) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Verificar se a categoria tem subcategorias
    const subCategorias = await prisma.categoria.count({
      where: {
        categoriaPaiId: id,
      },
    });

    if (subCategorias > 0) {
      return NextResponse.json(
        { error: "Não é possível excluir categoria que possui subcategorias" },
        { status: 400 }
      );
    }

    // Verificar se a categoria está sendo usada em contas
    const contasUsandoCategoria = await prisma.contaPagar.count({
      where: {
        categoriaId: id,
      },
    });

    const contasReceberUsandoCategoria = await prisma.contaReceber.count({
      where: {
        categoriaId: id,
      },
    });

    if (contasUsandoCategoria > 0 || contasReceberUsandoCategoria > 0) {
      return NextResponse.json(
        { error: "Não é possível excluir categoria que está sendo usada em contas" },
        { status: 400 }
      );
    }

    // Excluir o registro
    await prisma.categoria.delete({
      where: {
        id: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Categoria excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir categoria:", error);
    return NextResponse.json(
      { error: "Erro ao excluir categoria" },
      { status: 500 }
    );
  }
}
