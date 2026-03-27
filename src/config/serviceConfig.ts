export const API_BASE_URL = 'http://161.97.137.43:3000';
export const API_TOKEN = 'rafa-chave-123456';
export const CHAT_ENDPOINT = '/chat';
export const API_TIMEOUT_MS = 300000;

export function buildChatUrl(): string {
  const normalizedBaseUrl = API_BASE_URL.replace(/\/+$/, '');
  const normalizedEndpoint = CHAT_ENDPOINT.startsWith('/') ? CHAT_ENDPOINT : `/${CHAT_ENDPOINT}`;
  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}
