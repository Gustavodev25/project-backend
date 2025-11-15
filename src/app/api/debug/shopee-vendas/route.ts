import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Buscar todas as vendas do Shopee do usuário
    const vendas = await prisma.shopeeVenda.findMany({
      where: { userId: session.sub },
      select: {
        orderId: true,
        dataVenda: true,
        valorTotal: true,
        taxaPlataforma: true,
        frete: true,
        quantidade: true,
        rawData: true,
        paymentDetails: true,
        shipmentDetails: true,
      },
      orderBy: { dataVenda: "desc" },
      take: 20, // Últimas 20 vendas
    });

    // Processar cada venda para extrair informações relevantes
    const vendasProcessadas = vendas.map((venda) => {
      const rawData: any = venda.rawData || {};
      const paymentDetails: any = venda.paymentDetails || {};
      const shipmentDetails: any = venda.shipmentDetails || {};

      const totalAmountRaw = toNumber(rawData.total_amount);
      const buyerPaidShippingFee = toNumber(paymentDetails.buyer_paid_shipping_fee || shipmentDetails.buyer_paid_shipping_fee);
      const actualShippingFee = toNumber(paymentDetails.actual_shipping_fee || shipmentDetails.actual_shipping_fee);
      const shopeeShippingRebate = toNumber(paymentDetails.shopee_shipping_rebate || shipmentDetails.shopee_shipping_rebate);

      // Calcular a diferença
      const valorTotalDB = toNumber(venda.valorTotal);
      const diferencaComFrete = valorTotalDB - (totalAmountRaw + buyerPaidShippingFee);
      const diferencaSemFrete = valorTotalDB - totalAmountRaw;

      return {
        orderId: venda.orderId,
        dataVenda: venda.dataVenda.toISOString().split('T')[0],

        // Valores do banco
        valorTotalDB: valorTotalDB.toFixed(2),
        taxaPlataformaDB: toNumber(venda.taxaPlataforma).toFixed(2),
        freteDB: toNumber(venda.frete).toFixed(2),
        quantidadeDB: venda.quantidade,

        // Valores raw da API
        totalAmountRaw: totalAmountRaw.toFixed(2),
        buyerPaidShippingFee: buyerPaidShippingFee.toFixed(2),
        actualShippingFee: actualShippingFee.toFixed(2),
        shopeeShippingRebate: shopeeShippingRebate.toFixed(2),

        // Análise
        diferencaComFrete: diferencaComFrete.toFixed(2),
        diferencaSemFrete: diferencaSemFrete.toFixed(2),
        totalAmountIncluiFrete: Math.abs(diferencaSemFrete) < 0.01 ? "SIM" : "NÃO",
      };
    });

    // Calcular totais
    const somaValorTotalDB = vendas.reduce((acc, v) => acc + toNumber(v.valorTotal), 0);
    const somaQuantidade = vendas.reduce((acc, v) => acc + v.quantidade, 0);

    return NextResponse.json({
      message: "Debug de vendas do Shopee",
      totalVendas: vendas.length,
      somaValorTotal: somaValorTotalDB.toFixed(2),
      somaQuantidade,
      vendas: vendasProcessadas,
    });
  } catch (err) {
    console.error("Erro ao buscar vendas do Shopee:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
