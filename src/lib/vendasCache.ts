/**
 * Sistema de cache para vendas usando localStorage
 * Permite exibição instantânea de vendas enquanto atualiza em background
 */

export interface VendasCacheData {
  vendas: any[];
  timestamp: number;
  platform: string;
  total: number;
}

const CACHE_KEY_PREFIX = 'vendas_cache_';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 horas
const MAX_CACHED_VENDAS = 500; // Máximo de vendas no cache (evita QuotaExceeded)

/**
 * Gera a chave do cache baseada na plataforma
 */
function getCacheKey(platform: string): string {
  return `${CACHE_KEY_PREFIX}${platform.toLowerCase().replace(/\s+/g, '_')}`;
}

/**
 * Remove campos pesados das vendas para reduzir tamanho do cache
 */
function compressVenda(venda: any): any {
  // Manter apenas campos essenciais para exibição
  const {
    id,
    orderId,
    dataVenda,
    status,
    conta,
    valorTotal,
    quantidade,
    unitario,
    taxaPlataforma,
    frete,
    cmv,
    margemContribuicao,
    isMargemReal,
    titulo,
    sku,
    comprador,
    logisticType,
    shippingStatus,
    exposicao,
    tipoAnuncio,
    ads,
    plataforma,
    canal,
    // Remover campos pesados: rawData, tags, internalTags, raw, shipping (objeto completo)
  } = venda;

  return {
    id,
    orderId,
    dataVenda,
    status,
    conta,
    valorTotal,
    quantidade,
    unitario,
    taxaPlataforma,
    frete,
    cmv,
    margemContribuicao,
    isMargemReal,
    titulo,
    sku,
    comprador,
    logisticType,
    shippingStatus,
    exposicao,
    tipoAnuncio,
    ads,
    plataforma,
    canal,
  };
}

/**
 * Salva vendas no cache do localStorage
 * Limita a 500 vendas mais recentes e remove campos pesados
 */
export function saveVendasToCache(platform: string, vendas: any[]): void {
  try {
    // 1. Ordenar por data (mais recentes primeiro)
    const vendasOrdenadas = [...vendas].sort((a, b) => {
      const dateA = new Date(a.dataVenda).getTime();
      const dateB = new Date(b.dataVenda).getTime();
      return dateB - dateA; // Decrescente (mais recente primeiro)
    });

    // 2. Limitar ao máximo de vendas
    const vendasLimitadas = vendasOrdenadas.slice(0, MAX_CACHED_VENDAS);

    // 3. Comprimir vendas (remover campos pesados)
    const vendasComprimidas = vendasLimitadas.map(compressVenda);

    const cacheData: VendasCacheData = {
      vendas: vendasComprimidas,
      timestamp: Date.now(),
      platform,
      total: vendasComprimidas.length,
    };

    const cacheString = JSON.stringify(cacheData);
    const cacheSizeKB = Math.round(cacheString.length / 1024);

    localStorage.setItem(getCacheKey(platform), cacheString);
    console.log(`[VendasCache] ✅ Cache salvo para ${platform}: ${vendasComprimidas.length}/${vendas.length} vendas (${cacheSizeKB} KB)`);
    
    if (vendasComprimidas.length < vendas.length) {
      console.log(`[VendasCache] ℹ️ Limitado a ${MAX_CACHED_VENDAS} vendas mais recentes`);
    }
  } catch (error: any) {
    console.error('[VendasCache] ❌ Erro ao salvar cache:', error?.message || error);
    
    // Se erro de quota, tentar limpar e salvar com menos vendas
    if (error?.name === 'QuotaExceededError') {
      console.log('[VendasCache] 🧹 Limpando caches antigos...');
      clearOldCache();
      clearAllVendasCache();
      
      // Tentar salvar apenas as 200 vendas mais recentes
      try {
        const vendasReduzidas = vendas
          .sort((a, b) => new Date(b.dataVenda).getTime() - new Date(a.dataVenda).getTime())
          .slice(0, 200)
          .map(compressVenda);
          
        const cacheDataReduzido: VendasCacheData = {
          vendas: vendasReduzidas,
          timestamp: Date.now(),
          platform,
          total: vendasReduzidas.length,
        };
        
        localStorage.setItem(getCacheKey(platform), JSON.stringify(cacheDataReduzido));
        console.log(`[VendasCache] ✅ Cache salvo (reduzido) para ${platform}: ${vendasReduzidas.length} vendas`);
      } catch (retryError) {
        console.error('[VendasCache] ❌ Não foi possível salvar cache mesmo reduzido. LocalStorage pode estar cheio.');
        // Desistir silenciosamente - aplicação continua funcionando sem cache
      }
    }
  }
}

/**
 * Carrega vendas do cache do localStorage
 * Retorna null se não houver cache ou se estiver expirado
 */
export function loadVendasFromCache(platform: string): VendasCacheData | null {
  try {
    const cacheKey = getCacheKey(platform);
    const cached = localStorage.getItem(cacheKey);

    if (!cached) {
      console.log(`[VendasCache] Nenhum cache encontrado para ${platform}`);
      return null;
    }

    const cacheData: VendasCacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;

    // Verificar se cache expirou
    if (age > CACHE_TTL) {
      console.log(`[VendasCache] Cache expirado para ${platform} (${Math.round(age / 1000 / 60)} minutos)`);
      localStorage.removeItem(cacheKey);
      return null;
    }

    console.log(`[VendasCache] ✅ Cache carregado para ${platform}: ${cacheData.vendas.length} vendas (${Math.round(age / 1000 / 60)} min atrás)`);
    return cacheData;
  } catch (error) {
    console.error('[VendasCache] Erro ao carregar cache:', error);
    return null;
  }
}

/**
 * Verifica se existe cache válido para a plataforma
 */
export function hasCachedVendas(platform: string): boolean {
  const cacheData = loadVendasFromCache(platform);
  return cacheData !== null && cacheData.vendas.length > 0;
}

/**
 * Limpa o cache de uma plataforma específica
 */
export function clearVendasCache(platform: string): void {
  try {
    localStorage.removeItem(getCacheKey(platform));
    console.log(`[VendasCache] Cache limpo para ${platform}`);
  } catch (error) {
    console.error('[VendasCache] Erro ao limpar cache:', error);
  }
}

/**
 * Limpa todos os caches de vendas
 */
export function clearAllVendasCache(): void {
  try {
    const platforms = ['Mercado Livre', 'Shopee', 'Geral'];
    platforms.forEach(platform => clearVendasCache(platform));
    console.log('[VendasCache] Todos os caches limpos');
  } catch (error) {
    console.error('[VendasCache] Erro ao limpar todos os caches:', error);
  }
}

/**
 * Limpa caches antigos para liberar espaço
 */
function clearOldCache(): void {
  try {
    const keys = Object.keys(localStorage);
    const vendaCacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));

    vendaCacheKeys.forEach(key => {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const cacheData: VendasCacheData = JSON.parse(cached);
          const age = Date.now() - cacheData.timestamp;

          // Remover caches com mais de 24 horas
          if (age > CACHE_TTL) {
            localStorage.removeItem(key);
            console.log(`[VendasCache] Cache antigo removido: ${key}`);
          }
        }
      } catch {
        // Se falhar ao parsear, remover
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('[VendasCache] Erro ao limpar caches antigos:', error);
  }
}

/**
 * Obtém informações sobre o cache
 */
export function getCacheInfo(platform: string): {
  exists: boolean;
  count: number;
  ageMinutes: number;
  isExpired: boolean;
  sizeKB?: number;
} | null {
  const cacheData = loadVendasFromCache(platform);
  
  if (!cacheData) {
    return {
      exists: false,
      count: 0,
      ageMinutes: 0,
      isExpired: true,
    };
  }

  const age = Date.now() - cacheData.timestamp;
  const ageMinutes = Math.round(age / 1000 / 60);

  // Calcular tamanho aproximado
  const cacheString = localStorage.getItem(getCacheKey(platform));
  const sizeKB = cacheString ? Math.round(cacheString.length / 1024) : 0;

  return {
    exists: true,
    count: cacheData.vendas.length,
    ageMinutes,
    isExpired: age > CACHE_TTL,
    sizeKB,
  };
}

/**
 * Obtém informações sobre o uso total do localStorage
 */
export function getLocalStorageUsage(): {
  totalSizeKB: number;
  vendasCacheSizeKB: number;
  availableSpaceKB: number;
  percentUsed: number;
} {
  let totalSize = 0;
  let vendasCacheSize = 0;

  // Calcular tamanho total
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      const itemSize = (localStorage.getItem(key) || '').length;
      totalSize += itemSize;
      
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        vendasCacheSize += itemSize;
      }
    }
  }

  const totalSizeKB = Math.round(totalSize / 1024);
  const vendasCacheSizeKB = Math.round(vendasCacheSize / 1024);
  
  // Limite típico do localStorage: 5-10 MB (usar 5MB como conservador)
  const limitKB = 5 * 1024; // 5 MB
  const availableSpaceKB = Math.max(0, limitKB - totalSizeKB);
  const percentUsed = Math.round((totalSizeKB / limitKB) * 100);

  return {
    totalSizeKB,
    vendasCacheSizeKB,
    availableSpaceKB,
    percentUsed,
  };
}
