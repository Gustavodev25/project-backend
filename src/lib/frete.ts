export type FreteAdjustParams = {
  shipment_logistic_type: string | null;
  base_cost?: number | null;
  shipment_list_cost?: number | null;
  shipment_cost?: number | null;
  shipping_option_cost?: number | null; // <-- novo fallback
  order_cost?: number | null;
  quantity?: number | null;
};

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v: number): number {
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function calcularFreteAdjust(params: FreteAdjustParams): number {
  const lt = params.shipment_logistic_type ?? null;
  const baseCost = toNum(params.base_cost) ?? 0;
  const listCost = toNum(params.shipment_list_cost) ?? 0;

  // 👉 PRIORIDADE: shipping_option_cost PRIMEIRO (valor que comprador pagou)
  // Se não existir, usa shipment_cost como fallback
  let shipCost = toNum(params.shipping_option_cost);
  if (!shipCost || shipCost === 0) {
    shipCost = toNum(params.shipment_cost) ?? 0;
  }

  const qty = toNum(params.quantity);
  const numer = toNum(params.order_cost) ?? 0;
  const unitario = qty && qty !== 0 ? numer / qty : null;

  let raw: number;

  if (lt === "self_service") {
    const diffRoundedEqZero = round2(baseCost - listCost) === 0;
    if (diffRoundedEqZero) {
      if (unitario !== null && unitario < 79) {
        raw = 15.9;
      } else {
        raw = 1.59;
      }
    } else {
      raw = baseCost - listCost;
    }
  }
  else if (
    unitario !== null &&
    unitario >= 79 &&
    (lt === "drop_off" || lt === "xd_drop_off" || lt === "fulfillment" || lt === "cross_docking")
  ) {
    raw = listCost - (shipCost ?? 0);  // usa o fallback
  }
  else if (unitario !== null && unitario < 79) {
    raw = 0;
  }
  else {
    raw = 999;
  }

  const multiplier = lt === "self_service" ? 1 : -1;
  return round2(raw * multiplier);
}

export function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  } catch {
    return `R$ ${Number(value || 0).toFixed(2)}`;
  }
}

export function classifyFrete(value: number): { className: string; displayValue: string } {
  const displayValue = formatCurrency(value || 0);
  if (value > 0) return { className: "frete-positivo", displayValue };
  if (value < 0) return { className: "frete-negativo", displayValue };
  return { className: "frete-neutro", displayValue };
}

export interface ShopeeFreteData {
  actual_shipping_fee?: number;
  shopee_shipping_rebate?: number;
  buyer_paid_shipping_fee?: number;
  shipping_fee_discount_from_3pl?: number;
  reverse_shipping_fee?: number;
  productSubtotal?: number;
  totalTaxas?: number;
  rendaLiquida?: number;
}

export function detectarSubsidioFrete(freteData: ShopeeFreteData): {
  isSubsidized: boolean;
  subsidioDetectado: number;
  custoLiquidoFrete: number;
  tipoSubsidio: string;
} {
  const {
    actual_shipping_fee = 0,
    shopee_shipping_rebate = 0,
    buyer_paid_shipping_fee = 0,
    shipping_fee_discount_from_3pl = 0,
    reverse_shipping_fee = 0,
    productSubtotal = 0,
    totalTaxas = 0,
    rendaLiquida = 0
  } = freteData;

  const impliedCustoFrete = productSubtotal - totalTaxas - rendaLiquida;

  let subsidioDetectado = shopee_shipping_rebate;
  if (actual_shipping_fee && !shopee_shipping_rebate && Math.abs(impliedCustoFrete) < 0.01) {
    subsidioDetectado = actual_shipping_fee - buyer_paid_shipping_fee;
  }

  const custoLiquidoFrete =
    (buyer_paid_shipping_fee + subsidioDetectado + shipping_fee_discount_from_3pl) -
    (actual_shipping_fee + reverse_shipping_fee);
  let tipoSubsidio = "Nenhum";
  if (subsidioDetectado > 0) {
    tipoSubsidio = "Shopee";
  } else if (buyerPaidPositive(buyer_paid_shipping_fee)) {
    tipoSubsidio = "Comprador";
  } else if (shipping_fee_discount_from_3pl > 0) {
    tipoSubsidio = "3PL";
  }

  const isSubsidized =
    subsidioDetectado > 0 || buyerPaidPositive(buyer_paid_shipping_fee) || shipping_fee_discount_from_3pl > 0;

  return {
    isSubsidized,
    subsidioDetectado,
    custoLiquidoFrete,
    tipoSubsidio
  };

  function buyerPaidPositive(v: number) {
    return (v ?? 0) > 0;
  }
}

export function formatarFreteShopee(freteData: ShopeeFreteData): {
  valorPrincipal: string;
  className: string;
  mensagemEspecial?: string;
  detalhes: {
    custoReal: number;
    subsidioShopee: number;
    pagoComprador: number;
    custoLiquido: number;
  };
} {
  const { isSubsidized, subsidioDetectado, custoLiquidoFrete } = detectarSubsidioFrete(freteData);

  const valorPrincipal = formatCurrency(custoLiquidoFrete);
  const className =
    custoLiquidoFrete > 0 ? "frete-positivo" :
    custoLiquidoFrete < 0 ? "frete-negativo" : "frete-neutro";

  let mensagemEspecial: string | undefined;
  if (isSubsidized && Math.abs(custoLiquidoFrete) < 0.01) {
    mensagemEspecial = "O frete foi zerado ou totalmente subsidiado pela Shopee/Comprador.";
  }

  return {
    valorPrincipal,
    className,
    mensagemEspecial,
    detalhes: {
      custoReal: freteData.actual_shipping_fee || 0,
      subsidioShopee: subsidioDetectado,
      pagoComprador: freteData.buyer_paid_shipping_fee || 0,
      custoLiquido: custoLiquidoFrete
    }
  };
}
