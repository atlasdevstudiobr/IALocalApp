import {API_TIMEOUT_MS, API_TOKEN, buildChatUrl} from '../config/serviceConfig';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'RemoteChatService';
const MAX_EXTRACTION_DEPTH = 6;
const REPLY_CANDIDATE_KEYS = [
  'reply',
  'content',
  'text',
  'message',
  'output',
  'answer',
  'result',
  'response',
  'data',
] as const;

type RemotePayloadRecord = Record<string, unknown>;

interface RemoteChatErrorContext {
  statusCode?: number;
  url?: string;
  requestDurationMs?: number;
  totalDurationMs?: number;
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
  url?: string;
  requestDurationMs?: number;
  totalDurationMs?: number;

  constructor(code: RemoteChatErrorCode, message: string, context?: RemoteChatErrorContext) {
    super(message);
    this.name = 'RemoteChatError';
    this.code = code;
    this.statusCode = context?.statusCode;
    this.url = context?.url;
    this.requestDurationMs = context?.requestDurationMs;
    this.totalDurationMs = context?.totalDurationMs;
  }
}

function isRecord(value: unknown): value is RemotePayloadRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExplicitRejectionFlag(value: unknown): boolean {
  return value === false || value === 0 || value === 'false' || value === '0';
}

function isApiRejection(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  return isExplicitRejectionFlag(payload.ok) || isExplicitRejectionFlag(payload.success);
}

function nowMs(): number {
  return Date.now();
}

function formatTimings(details: RemoteChatErrorContext): string {
  const chunks = [
    details.url ? `url=${details.url}` : '',
    typeof details.statusCode === 'number' ? `status=${details.statusCode}` : '',
    typeof details.requestDurationMs === 'number'
      ? `requestDurationMs=${details.requestDurationMs}`
      : '',
    typeof details.totalDurationMs === 'number' ? `totalDurationMs=${details.totalDurationMs}` : '',
  ].filter(Boolean);
  return chunks.join('\n');
}

function buildTimeoutError(
  url: string,
  requestStartedAt: number,
  timeoutMs: number,
  requestDurationMs?: number,
): RemoteChatError {
  return new RemoteChatError('timeout', `Timeout apos ${timeoutMs}ms`, {
    url,
    requestDurationMs,
    totalDurationMs: nowMs() - requestStartedAt,
  });
}

function normalizeReply(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function extractReplyFromPayload(
  payload: unknown,
  depth = 0,
  visited: Set<unknown> = new Set(),
): string {
  if (depth > MAX_EXTRACTION_DEPTH) {
    return '';
  }

  const directReply = normalizeReply(payload);
  if (directReply) {
    return directReply;
  }

  if (Array.isArray(payload)) {
    const parts = payload
      .map(item => extractReplyFromPayload(item, depth + 1, visited))
      .filter(part => Boolean(part));
    return normalizeReply(parts.join('\n'));
  }

  if (!isRecord(payload) || visited.has(payload)) {
    return '';
  }
  visited.add(payload);

  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      const choiceReply = extractReplyFromPayload(choice, depth + 1, visited);
      if (choiceReply) {
        return choiceReply;
      }
    }
  }

  for (const key of REPLY_CANDIDATE_KEYS) {
    const candidate = extractReplyFromPayload(payload[key], depth + 1, visited);
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

function attachMissingContext(
  error: RemoteChatError,
  context: RemoteChatErrorContext,
): RemoteChatError {
  if (typeof error.statusCode !== 'number' && typeof context.statusCode === 'number') {
    error.statusCode = context.statusCode;
  }
  if (!error.url && context.url) {
    error.url = context.url;
  }
  if (typeof error.requestDurationMs !== 'number' && typeof context.requestDurationMs === 'number') {
    error.requestDurationMs = context.requestDurationMs;
  }
  if (typeof error.totalDurationMs !== 'number' && typeof context.totalDurationMs === 'number') {
    error.totalDurationMs = context.totalDurationMs;
  }
  return error;
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

export async function sendRemoteChatMessage(
  message: string,
  onPartial?: (partialText: string) => void,
): Promise<string> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new RemoteChatError('invalid_response', 'Mensagem vazia enviada para o endpoint remoto');
  }

  const url = buildChatUrl();
  const requestStartedAt = nowMs();
  const timeoutMs =
    Number.isFinite(API_TIMEOUT_MS) && API_TIMEOUT_MS > 0 ? Math.floor(API_TIMEOUT_MS) : 90000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;

  if (controller) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  let response: Response;
  let responseReceivedAt: number | null = null;
  try {
    logInfo(
      TAG,
      'Enviando mensagem para API remota',
      `url=${url}\ntimeoutMs=${timeoutMs}\nmessageChars=${trimmedMessage.length}`,
    );

    const fetchConfig: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({message: trimmedMessage}),
    };
    if (controller) {
      fetchConfig.signal = controller.signal;
      response = await fetch(url, fetchConfig);
    } else {
      const timeoutPromise = new Promise<Response>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          reject(buildTimeoutError(url, requestStartedAt, timeoutMs));
        }, timeoutMs);
      });
      response = await Promise.race<Response>([fetch(url, fetchConfig), timeoutPromise]);
    }
    responseReceivedAt = nowMs();
  } catch (error) {
    const elapsedMs = nowMs() - requestStartedAt;
    const context: RemoteChatErrorContext = {url, totalDurationMs: elapsedMs};

    if (error instanceof RemoteChatError) {
      throw attachMissingContext(error, context);
    }
    if (didTimeout || isAbortError(error)) {
      throw buildTimeoutError(url, requestStartedAt, timeoutMs);
    }
    if (isLikelyNetworkError(error)) {
      throw new RemoteChatError('network', 'Falha de conectividade ao acessar API remota', context);
    }
    throw new RemoteChatError('network', `Falha de rede inesperada: ${String(error)}`, context);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const requestDurationMs =
    responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : nowMs() - requestStartedAt;

  if (!response.ok) {
    throw new RemoteChatError('http', `HTTP ${response.status}`, {
      statusCode: response.status,
      url,
      requestDurationMs,
      totalDurationMs: nowMs() - requestStartedAt,
    });
  }

  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch (error) {
    throw new RemoteChatError('invalid_response', `Falha ao ler corpo da resposta: ${String(error)}`, {
      statusCode: response.status,
      url,
      requestDurationMs,
      totalDurationMs: nowMs() - requestStartedAt,
    });
  }

  const totalDurationMs = nowMs() - requestStartedAt;
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    throw new RemoteChatError('invalid_response', 'Corpo da resposta remoto vazio', {
      statusCode: response.status,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  let payload: unknown = trimmedBody;
  let parseMode: 'json' | 'text' = 'text';
  try {
    payload = JSON.parse(trimmedBody);
    parseMode = 'json';
  } catch (_error) {
    payload = trimmedBody;
    parseMode = 'text';
  }

  if (isApiRejection(payload)) {
    throw new RemoteChatError('api_rejected', 'API retornou ok=false', {
      statusCode: response.status,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  const reply = extractReplyFromPayload(payload);
  if (!reply) {
    throw new RemoteChatError('invalid_response', 'Campo reply vazio ou invalido', {
      statusCode: response.status,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  if (onPartial) {
    onPartial(reply);
  }

  logInfo(
    TAG,
    'Resposta remota recebida com sucesso',
    [
      `url=${url}`,
      `status=${response.status}`,
      `requestDurationMs=${requestDurationMs}`,
      `totalDurationMs=${totalDurationMs}`,
      `chars=${reply.length}`,
      `parseMode=${parseMode}`,
    ].join('\n'),
  );
  return reply;
}

export function logRemoteChatError(error: unknown): void {
  if (error instanceof RemoteChatError) {
    const details = [
      `code=${error.code}`,
      formatTimings({
        statusCode: error.statusCode,
        url: error.url,
        requestDurationMs: error.requestDurationMs,
        totalDurationMs: error.totalDurationMs,
      }),
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
