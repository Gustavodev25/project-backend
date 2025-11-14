const SHOPEE_CANCELLED_KEYWORDS = ["cancel", "void", "return", "refund", "fail"];
const SHOPEE_PENDING_STATUSES = ["unpaid", "pending", "awaiting_payment", "to_pay"];
const SHOPEE_PAID_STATUSES = [
  "ready_to_ship",
  "processed",
  "to_ship",
  "to_confirm_receive",
  "completed",
  "shipped",
  "retry_ship",
  "pickup_done",
  "arranging_shipment",
  "packed",
  "first_mile_arrived",
];

const MERCADO_LIVRE_PAID_STATUSES = ["paid", "pago", "payment_approved"];
const MERCADO_LIVRE_CANCELLED_STATUSES = ["cancelled", "cancelado"];

function normalizeStatus(status?: string): string {
  return status?.toLowerCase().trim() ?? "";
}

function isShopeeStatusCancelado(normalizedStatus: string): boolean {
  return SHOPEE_CANCELLED_KEYWORDS.some((keyword) =>
    normalizedStatus.includes(keyword),
  );
}

function isShopeeStatusPago(normalizedStatus: string): boolean {
  if (!normalizedStatus) return false;
  if (SHOPEE_PENDING_STATUSES.includes(normalizedStatus)) return false;
  if (isShopeeStatusCancelado(normalizedStatus)) return false;
  if (SHOPEE_PAID_STATUSES.includes(normalizedStatus)) return true;
  return true;
}

function isMercadoLivreStatusCancelado(normalizedStatus: string): boolean {
  return MERCADO_LIVRE_CANCELLED_STATUSES.includes(normalizedStatus);
}

function isMercadoLivreStatusPago(normalizedStatus: string): boolean {
  return MERCADO_LIVRE_PAID_STATUSES.includes(normalizedStatus);
}

export function isStatusCancelado(status: string | undefined, platform: string): boolean {
  const normalizedStatus = normalizeStatus(status);
  if (!normalizedStatus) return false;

  const normalizedPlatform = platform.toLowerCase();

  switch (normalizedPlatform) {
    case "shopee":
      return isShopeeStatusCancelado(normalizedStatus);
    case "geral":
      return (
        isMercadoLivreStatusCancelado(normalizedStatus) ||
        isShopeeStatusCancelado(normalizedStatus)
      );
    default:
      return isMercadoLivreStatusCancelado(normalizedStatus);
  }
}

export function isStatusPago(status: string | undefined, platform: string): boolean {
  const normalizedStatus = normalizeStatus(status);
  if (!normalizedStatus) return false;

  const normalizedPlatform = platform.toLowerCase();

  switch (normalizedPlatform) {
    case "shopee":
      return isShopeeStatusPago(normalizedStatus);
    case "geral":
      return (
        isMercadoLivreStatusPago(normalizedStatus) ||
        isShopeeStatusPago(normalizedStatus)
      );
    default:
      return isMercadoLivreStatusPago(normalizedStatus);
  }
}
