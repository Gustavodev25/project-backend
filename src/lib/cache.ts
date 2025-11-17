/**
 * Sistema de cache simples em memória para otimização de performance
 * Utilizado para reduzir chamadas repetitivas ao banco de dados
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class MemoryCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 60000; // 1 minuto padrão

  /**
   * Busca um valor do cache
   * @param key Chave do cache
   * @param ttl Tempo de vida em milissegundos (opcional, usa padrão se não especificado)
   * @returns Valor do cache ou null se expirou/não existe
   */
  get<T>(key: string, ttl?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const cacheTTL = ttl ?? this.defaultTTL;
    const isExpired = Date.now() - entry.timestamp > cacheTTL;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Armazena um valor no cache
   * @param key Chave do cache
   * @param data Dados a serem armazenados
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Remove um valor específico do cache
   * @param key Chave do cache
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Remove todos os valores do cache que correspondem a um padrão
   * @param pattern Padrão de busca (substring)
   */
  deletePattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Retorna o tamanho atual do cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Define o TTL padrão
   * @param ttl Tempo de vida em milissegundos
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }
}

// Exportar instância singleton
export const cache = new MemoryCache();

/**
 * Helper para criar chaves de cache padronizadas
 */
export function createCacheKey(prefix: string, ...args: (string | number)[]): string {
  return `${prefix}:${args.join(":")}`;
}

/**
 * Helper para invalidar cache relacionado a um usuário
 */
export function invalidateUserCache(userId: string): void {
  cache.deletePattern(`user:${userId}`);
}

/**
 * Helper para invalidar cache de vendas
 */
export function invalidateVendasCache(userId: string): void {
  cache.deletePattern(`vendas:${userId}`);
  cache.deletePattern(`vendas-meli:${userId}`);
  cache.deletePattern(`vendas-shopee:${userId}`);
  cache.deletePattern(`vendas-geral:${userId}`);
}

/**
 * Helper para invalidar cache de SKUs
 */
export function invalidateSKUCache(userId: string): void {
  cache.deletePattern(`sku:${userId}`);
}
