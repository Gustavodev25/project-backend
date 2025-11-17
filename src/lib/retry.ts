/**
 * Executa uma função com retry e backoff exponencial
 * @param fn Função a ser executada
 * @param maxAttempts Número máximo de tentativas
 * @param baseDelay Delay base em milissegundos
 * @param maxDelay Delay máximo em milissegundos
 * @returns Promise com o resultado da função
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Se é a última tentativa, não aguarda
      if (attempt === maxAttempts) {
        break;
      }
      
      // Calcular delay com backoff exponencial
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1),
        maxDelay
      );
      
      // Adicionar jitter aleatório para evitar thundering herd
      const jitter = Math.random() * 0.1 * delay;
      const totalDelay = delay + jitter;
      
      console.log(`Tentativa ${attempt} falhou, tentando novamente em ${Math.round(totalDelay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
  
  throw lastError!;
}

/**
 * Verifica se um erro é recuperável (deve tentar novamente)
 * @param error Erro a ser verificado
 * @returns true se o erro é recuperável
 */
export function isRecoverableError(error: any): boolean {
  if (!error) return false;
  
  const message = error.message?.toLowerCase() || '';
  const status = error.status || error.statusCode;
  
  // Erros de rede e timeout são recuperáveis
  if (message.includes('network') || 
      message.includes('timeout') || 
      message.includes('econnreset') ||
      message.includes('enotfound')) {
    return true;
  }
  
  // Status codes específicos que são recuperáveis
  if (status === 429 || // Rate limit
      status === 502 || // Bad Gateway
      status === 503 || // Service Unavailable
      status === 504) { // Gateway Timeout
    return true;
  }
  
  return false;
}
