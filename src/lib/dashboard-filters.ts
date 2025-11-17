/**
 * Helper functions para filtros do dashboard
 * Centraliza a lógica de filtros para garantir consistência entre todos os endpoints
 */

export type StatusFilter = 'pagos' | 'cancelados' | 'todos';

/**
 * Cria filtro de status que funciona tanto para Mercado Livre quanto Shopee
 * - Mercado Livre: 'paid' para pagos, 'cancelled' para cancelados
 * - Shopee: 'COMPLETED' para pagos, 'CANCELLED' para cancelados
 */
export function getStatusWhere(statusParam?: string | null) {
  // Cancelados: cobre variações (cancel/cancelled/cancelado)
  if (statusParam === 'cancelados') {
    return {
      OR: [
        { status: { contains: 'cancel', mode: 'insensitive' as const } },
        { status: { contains: 'cancelled', mode: 'insensitive' as const } },
      ],
    };
  }

  // Todos: sem filtro de status
  if (statusParam === 'todos') {
    return {};
  }

  // Pagos: incluir variações reais usadas por ML e Shopee
  // - Mercado Livre: paid, payment_approved
  // - Shopee (pagos/ativos): completed, shipped, ready_to_ship, to_ship, to_confirm_receive, processed, packed, retry_ship, pickup_done, arranging_shipment, first_mile_arrived
  return {
    OR: [
      // Mercado Livre
      { status: { contains: 'paid', mode: 'insensitive' as const } },
      { status: { contains: 'payment_approved', mode: 'insensitive' as const } },
      { status: { contains: 'delivered', mode: 'insensitive' as const } },

      // Shopee (conjunto de estados que representam pedidos pagos/ativos)
      { status: { contains: 'completed', mode: 'insensitive' as const } },
      { status: { contains: 'shipped', mode: 'insensitive' as const } },
      { status: { contains: 'ready_to_ship', mode: 'insensitive' as const } },
      { status: { contains: 'to_ship', mode: 'insensitive' as const } },
      { status: { contains: 'to_confirm_receive', mode: 'insensitive' as const } },
      { status: { contains: 'processed', mode: 'insensitive' as const } },
      { status: { contains: 'packed', mode: 'insensitive' as const } },
      { status: { contains: 'retry_ship', mode: 'insensitive' as const } },
      { status: { contains: 'pickup_done', mode: 'insensitive' as const } },
      { status: { contains: 'arranging_shipment', mode: 'insensitive' as const } },
      { status: { contains: 'first_mile_arrived', mode: 'insensitive' as const } },
    ],
  };
}

/**
 * Cria filtro de canal/plataforma
 */
export function getCanalWhere(canalParam?: string | null) {
  if (canalParam === 'shopee') {
    return { plataforma: { contains: 'shopee', mode: 'insensitive' as const } };
  }

  if (canalParam === 'mercado_livre') {
    return { plataforma: { contains: 'mercado', mode: 'insensitive' as const } };
  }

  return {};
}

/**
 * Cria filtro de tipo de anúncio (apenas Mercado Livre)
 */
export function getTipoAnuncioWhere(tipoParam?: string | null) {
  if (tipoParam === 'catalogo') {
    return {
      OR: [
        { tipoAnuncio: { contains: 'catalog', mode: 'insensitive' as const } },
        { tipoAnuncio: { contains: 'catálogo', mode: 'insensitive' as const } }
      ]
    };
  }

  if (tipoParam === 'proprio') {
    return {
      OR: [
        { tipoAnuncio: { contains: 'proprio', mode: 'insensitive' as const } },
        { tipoAnuncio: { contains: 'próprio', mode: 'insensitive' as const } }
      ]
    };
  }

  return {};
}

/**
 * Cria filtro de modalidade de envio (apenas Mercado Livre)
 */
export function getModalidadeWhere(modalidadeParam?: string | null) {
  if (modalidadeParam === 'full') {
    return { logisticType: { contains: 'fulfill', mode: 'insensitive' as const } };
  }

  if (modalidadeParam === 'flex') {
    return { logisticType: { contains: 'flex', mode: 'insensitive' as const } };
  }

  if (modalidadeParam === 'me') {
    return {
      NOT: [
        { logisticType: { contains: 'fulfill', mode: 'insensitive' as const } },
        { logisticType: { contains: 'flex', mode: 'insensitive' as const } }
      ]
    };
  }

  return {};
}
