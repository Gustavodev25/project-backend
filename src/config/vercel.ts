/**
 * Configurações de timeout para Vercel
 *
 * Plano Hobby: 10 segundos max
 * Plano Pro: 60 segundos recomendado
 * Plano Enterprise: até 900 segundos
 */

// Usar 60 segundos para Pro (mais seguro que 300)
export const MAX_DURATION_DEFAULT = 60;

// Para operações rápidas (leitura simples)
export const MAX_DURATION_FAST = 10;

// Para operações assíncronas que retornam imediatamente
export const MAX_DURATION_ASYNC = 10;
