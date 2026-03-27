import {API_TIMEOUT_MS, API_TOKEN, buildChatUrl} from '../config/serviceConfig';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'RemoteChatService';

interface RemoteChatApiResponse {
  ok?: unknown;
  reply?: unknown;
}

export type RemoteChatErrorCode =
  | 'timeout'
  | 'network'
  | 'http'
  | 'api_rejected'
  | 'invalid_response';

export class RemoteChatError extends Error {
  code: RemoteChatErrorCode;
  statusCode?: number;

  constructor(code: RemoteChatErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'RemoteChatError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return true;
    }
    return /abort/i.test(error.message);
  }
  return false;
}

function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('internet')
  );
}

function normalizeReply(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function sendRemoteChatMessage(
  message: string,
  onPartial?: (partialText: string) => void,
): Promise<string> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new RemoteChatError('invalid_response', 'Mensagem vazia enviada para o endpoint remoto');
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, API_TIMEOUT_MS);
  }

  const url = buildChatUrl();
  let response: Response;
  try {
    logInfo(TAG, 'Enviando mensagem para API remota', `url=${url}`);
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({message: trimmedMessage}),
      signal: controller?.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new RemoteChatError('timeout', `Timeout apos ${API_TIMEOUT_MS}ms`);
    }
    if (isLikelyNetworkError(error)) {
      throw new RemoteChatError('network', 'Falha de conectividade ao acessar API remota');
    }
    throw new RemoteChatError('network', `Falha de rede inesperada: ${String(error)}`);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    throw new RemoteChatError('http', `HTTP ${response.status}`, response.status);
  }

  let data: RemoteChatApiResponse;
  try {
    data = (await response.json()) as RemoteChatApiResponse;
  } catch (error) {
    throw new RemoteChatError('invalid_response', `Falha ao parsear JSON: ${String(error)}`);
  }

  if (data.ok !== true) {
    throw new RemoteChatError('api_rejected', 'API retornou ok=false');
  }

  const reply = normalizeReply(data.reply);
  if (!reply) {
    throw new RemoteChatError('invalid_response', 'Campo reply vazio ou invalido');
  }

  if (onPartial) {
    onPartial(reply);
  }

  logInfo(TAG, 'Resposta remota recebida com sucesso', `chars=${reply.length}`);
  return reply;
}

export function logRemoteChatError(error: unknown): void {
  if (error instanceof RemoteChatError) {
    const details = [
      `code=${error.code}`,
      typeof error.statusCode === 'number' ? `status=${error.statusCode}` : '',
      `message=${error.message}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (error.code === 'http' || error.code === 'api_rejected' || error.code === 'invalid_response') {
      logWarn(TAG, 'Falha de resposta da API remota', details);
      return;
    }

    logWarn(TAG, 'Falha de conectividade/timeout na API remota', details);
    return;
  }

  logError(TAG, 'Erro inesperado na API remota', String(error));
}
