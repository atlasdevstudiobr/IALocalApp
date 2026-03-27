import {API_TIMEOUT_MS, API_TOKEN, buildChatUrl} from '../config/serviceConfig';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'RemoteChatService';
const MAX_EXTRACTION_DEPTH = 6;
const STREAM_ACCEPT_CONTENT_TYPE = 'text/event-stream';
const REPLY_CANDIDATE_KEYS = [
  'reply',
  'final',
  'final_text',
  'generated_text',
  'output_text',
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

type ParseMode = 'json' | 'text' | 'sse_json' | 'sse_text' | 'ndjson_json' | 'ndjson_text';
type TimeoutPhase = 'connection' | 'first_token' | 'stream_idle' | 'total';

interface RemoteChatTimeouts {
  connectionTimeoutMs: number;
  firstTokenTimeoutMs: number;
  streamIdleTimeoutMs: number;
  totalTimeoutMs: number;
}

interface RemoteChatSuccess {
  reply: string;
  parseMode: ParseMode;
  requestDurationMs: number;
  totalDurationMs: number;
  statusCode: number;
}

interface RemoteChatErrorContext {
  statusCode?: number;
  url?: string;
  requestDurationMs?: number;
  totalDurationMs?: number;
  timeoutPhase?: TimeoutPhase;
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
  timeoutPhase?: TimeoutPhase;

  constructor(code: RemoteChatErrorCode, message: string, context?: RemoteChatErrorContext) {
    super(message);
    this.name = 'RemoteChatError';
    this.code = code;
    this.statusCode = context?.statusCode;
    this.url = context?.url;
    this.requestDurationMs = context?.requestDurationMs;
    this.totalDurationMs = context?.totalDurationMs;
    this.timeoutPhase = context?.timeoutPhase;
  }
}

interface SseParserState {
  buffer: string;
  ndjsonBuffer: string;
  dataLines: string[];
  eventName: string;
  fullReply: string;
  doneReply: string;
  sawSsePayload: boolean;
  sawNdjsonPayload: boolean;
  sawJsonPayload: boolean;
  sawTextPayload: boolean;
  sawDoneSentinel: boolean;
  sawStreamSignal: boolean;
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

function clampTimeoutMs(value: number, minMs: number, maxMs: number): number {
  if (!Number.isFinite(value)) {
    return minMs;
  }
  return Math.max(minMs, Math.min(maxMs, Math.floor(value)));
}

function buildRemoteChatTimeouts(baseTimeoutMs: number): RemoteChatTimeouts {
  const totalTimeoutMs = clampTimeoutMs(baseTimeoutMs, 120000, 900000);
  return {
    connectionTimeoutMs: clampTimeoutMs(totalTimeoutMs * 0.1, 8000, 45000),
    firstTokenTimeoutMs: clampTimeoutMs(totalTimeoutMs * 0.35, 30000, 240000),
    streamIdleTimeoutMs: clampTimeoutMs(totalTimeoutMs * 0.6, 45000, 300000),
    totalTimeoutMs,
  };
}

function formatTimings(details: RemoteChatErrorContext): string {
  const chunks = [
    details.url ? `url=${details.url}` : '',
    typeof details.statusCode === 'number' ? `status=${details.statusCode}` : '',
    details.timeoutPhase ? `timeoutPhase=${details.timeoutPhase}` : '',
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
  timeoutPhase: TimeoutPhase,
  requestDurationMs?: number,
): RemoteChatError {
  const labels: Record<TimeoutPhase, string> = {
    connection: 'Timeout de conexao',
    first_token: 'Timeout aguardando primeiro chunk de stream',
    stream_idle: 'Timeout com stream ativo sem novos chunks',
    total: 'Timeout total',
  };
  return new RemoteChatError('timeout', `${labels[timeoutPhase]} apos ${timeoutMs}ms`, {
    url,
    requestDurationMs,
    totalDurationMs: nowMs() - requestStartedAt,
    timeoutPhase,
  });
}

function normalizeReply(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function readStringPreservingSpacing(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : '';
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
  if (!error.timeoutPhase && context.timeoutPhase) {
    error.timeoutPhase = context.timeoutPhase;
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

function createSseParserState(): SseParserState {
  return {
    buffer: '',
    ndjsonBuffer: '',
    dataLines: [],
    eventName: '',
    fullReply: '',
    doneReply: '',
    sawSsePayload: false,
    sawNdjsonPayload: false,
    sawJsonPayload: false,
    sawTextPayload: false,
    sawDoneSentinel: false,
    sawStreamSignal: false,
  };
}

function normalizeEventName(value: unknown): string {
  return readStringPreservingSpacing(value).trim().toLowerCase();
}

function isDoneSentinelChunk(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '[done]' || normalized === 'done' || normalized === '[end]';
}

function isDoneLikeEvent(eventName: string): boolean {
  if (!eventName) {
    return false;
  }
  return (
    eventName === 'done' ||
    eventName === 'end' ||
    eventName === 'completed' ||
    eventName.endsWith('.done') ||
    eventName.endsWith('.completed') ||
    eventName.endsWith('.end')
  );
}

function isLikelyStreamPayload(payload: RemotePayloadRecord): boolean {
  const hasTokenLike =
    typeof payload.partial === 'string' ||
    typeof payload.token === 'string' ||
    typeof payload.delta === 'string' ||
    typeof payload.chunk === 'string' ||
    typeof payload.response === 'string';
  const hasDoneLike =
    payload.done === true ||
    payload.done === false ||
    payload.completed === true ||
    payload.completed === false;
  const hasEventLike = Boolean(normalizeEventName(payload.event) || normalizeEventName(payload.type));
  return hasTokenLike || hasDoneLike || hasEventLike;
}

function resolveNestedSseToken(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n');
  }

  if (!Array.isArray(value)) {
    return '';
  }

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const nestedCandidates = [
      item.delta,
      item.partial,
      item.text,
      item.content,
      isRecord(item.delta) ? item.delta.content : undefined,
      isRecord(item.message) ? item.message.content : item.message,
    ];
    for (const candidate of nestedCandidates) {
      const token = readStringPreservingSpacing(candidate);
      if (token) {
        return token;
      }
    }
  }

  return '';
}

function resolveSseToken(payload: RemotePayloadRecord, doneFlag: boolean): string {
  const directCandidates = [
    payload.partial,
    payload.token,
    payload.delta,
    payload.chunk,
    payload.value,
    payload.output_text,
    resolveNestedSseToken(payload.choices),
    resolveNestedSseToken(payload.content),
  ];
  for (const candidate of directCandidates) {
    const token = readStringPreservingSpacing(candidate);
    if (token) {
      return token;
    }
  }

  if (!doneFlag) {
    const fallbackCandidates = [
      payload.response,
      payload.content,
      payload.text,
      payload.message,
      payload.answer,
      payload.output,
      payload.result,
      payload.data,
    ];
    for (const candidate of fallbackCandidates) {
      const token = readStringPreservingSpacing(candidate);
      if (token) {
        return token;
      }
    }
  }

  return '';
}

function mergeStreamPiece(current: string, incoming: string): string {
  const next = incoming;
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  if (next === current) {
    return current;
  }

  if (next.startsWith(current)) {
    return next;
  }
  if (current.startsWith(next) || current.endsWith(next)) {
    return current;
  }
  if (next.includes(current) && next.length > current.length) {
    return next;
  }

  const overlapLimit = Math.min(current.length, next.length);
  for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
    if (current.endsWith(next.slice(0, overlap))) {
      return `${current}${next.slice(overlap)}`;
    }
  }

  return `${current}${next}`;
}

function processSseDataPayload(
  dataPayload: string,
  state: SseParserState,
  eventNameHint: string,
  payloadSource: 'sse' | 'ndjson',
  onPartial?: (partialText: string) => void,
): void {
  const raw = dataPayload.replace(/\r\n/g, '\n');
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }

  if (payloadSource === 'sse') {
    state.sawSsePayload = true;
  } else {
    state.sawNdjsonPayload = true;
  }
  if (isDoneSentinelChunk(trimmed)) {
    state.sawDoneSentinel = true;
    state.sawStreamSignal = true;
    return;
  }

  try {
    const payload: unknown = JSON.parse(trimmed);
    state.sawJsonPayload = true;

    if (!isRecord(payload)) {
      const textValue = normalizeReply(payload);
      if (textValue) {
        state.fullReply = mergeStreamPiece(state.fullReply, textValue);
        onPartial?.(state.fullReply);
      }
      return;
    }

    if (isApiRejection(payload)) {
      throw new RemoteChatError('api_rejected', 'API retornou ok=false durante stream');
    }

    const eventName = [
      normalizeEventName(eventNameHint),
      normalizeEventName(payload.event),
      normalizeEventName(payload.type),
      normalizeEventName(payload.name),
      normalizeEventName(payload.state),
    ]
      .filter(Boolean)
      .join(':');
    if (eventName.includes('error')) {
      const detail =
        normalizeReply(payload.detail) ||
        normalizeReply(payload.error) ||
        normalizeReply(payload.message) ||
        'Falha reportada durante stream remoto';
      throw new RemoteChatError('invalid_response', detail);
    }

    if (eventName || isLikelyStreamPayload(payload)) {
      state.sawStreamSignal = true;
    }

    const doneFlag =
      payload.done === true ||
      payload.completed === true ||
      payload.finish === true ||
      payload.finished === true ||
      normalizeEventName(payload.status) === 'completed' ||
      isDoneLikeEvent(eventName);
    const token = resolveSseToken(payload, doneFlag);
    if (token) {
      state.fullReply = mergeStreamPiece(state.fullReply, token);
      onPartial?.(state.fullReply);
    }

    if (doneFlag) {
      const doneReply =
        readStringPreservingSpacing(payload.reply) ||
        readStringPreservingSpacing(payload.final) ||
        readStringPreservingSpacing(payload.output_text) ||
        readStringPreservingSpacing(payload.generated_text) ||
        extractReplyFromPayload(payload);
      if (doneReply.trim()) {
        state.doneReply = doneReply;
      }
    }
  } catch (error) {
    if (error instanceof RemoteChatError) {
      throw error;
    }

    state.sawTextPayload = true;
    state.fullReply = mergeStreamPiece(state.fullReply, raw);
    onPartial?.(state.fullReply);
  }
}

function flushSseEvent(
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): void {
  if (state.dataLines.length === 0) {
    state.eventName = '';
    return;
  }
  const payload = state.dataLines.join('\n');
  const eventName = state.eventName;
  state.dataLines = [];
  state.eventName = '';
  processSseDataPayload(payload, state, eventName, 'sse', onPartial);
}

function consumeSseChunk(
  chunk: string,
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): void {
  state.buffer += chunk;

  while (true) {
    const newlineIndex = state.buffer.indexOf('\n');
    if (newlineIndex < 0) {
      break;
    }

    let line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }

    if (!line) {
      flushSseEvent(state, onPartial);
      continue;
    }

    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      let eventName = line.slice(6);
      if (eventName.startsWith(' ')) {
        eventName = eventName.slice(1);
      }
      state.eventName = eventName.trim();
      continue;
    }

    if (line.startsWith('data:')) {
      let data = line.slice(5);
      if (data.startsWith(' ')) {
        data = data.slice(1);
      }
      state.dataLines.push(data);
      const trimmedData = data.trim();
      if (
        isDoneSentinelChunk(trimmedData) ||
        trimmedData.startsWith('{') ||
        trimmedData.startsWith('[')
      ) {
        flushSseEvent(state, onPartial);
      }
      continue;
    }

    if (line.startsWith('id:') || line.startsWith('retry:')) {
      continue;
    }

    state.dataLines.push(line);
    if (line.startsWith('{') || line.startsWith('[') || isDoneSentinelChunk(line)) {
      flushSseEvent(state, onPartial);
    }
  }
}

function consumeNdjsonChunk(
  chunk: string,
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): void {
  state.ndjsonBuffer += chunk;

  while (true) {
    const newlineIndex = state.ndjsonBuffer.indexOf('\n');
    if (newlineIndex < 0) {
      break;
    }

    let line = state.ndjsonBuffer.slice(0, newlineIndex);
    state.ndjsonBuffer = state.ndjsonBuffer.slice(newlineIndex + 1);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }

    if (!line.trim()) {
      continue;
    }
    processSseDataPayload(line, state, '', 'ndjson', onPartial);
  }
}

function consumeFlexibleStreamChunk(
  chunk: string,
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): void {
  const normalized = chunk.replace(/\r\n/g, '\n');
  const likelySseChunk =
    state.sawSsePayload ||
    normalized.includes('\ndata:') ||
    normalized.startsWith('data:') ||
    normalized.includes('\nevent:') ||
    normalized.startsWith('event:') ||
    normalized.startsWith(':');

  if (likelySseChunk) {
    consumeSseChunk(chunk, state, onPartial);
    return;
  }

  consumeNdjsonChunk(chunk, state, onPartial);
}

function finalizeSseState(
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): {reply: string; parseMode: ParseMode} {
  const remaining = state.buffer.replace(/\r\n/g, '\n').trim();
  if (remaining) {
    if (remaining.startsWith('data:')) {
      let data = remaining.slice(5);
      if (data.startsWith(' ')) {
        data = data.slice(1);
      }
      state.dataLines.push(data);
    } else {
      state.dataLines.push(remaining);
    }
  }
  state.buffer = '';

  flushSseEvent(state, onPartial);

  const reply = normalizeReply(state.doneReply || state.fullReply);
  if (!reply) {
    throw new RemoteChatError('invalid_response', 'Stream remoto finalizou sem resposta valida');
  }

  const parseMode: ParseMode = state.sawJsonPayload ? 'sse_json' : 'sse_text';
  return {reply, parseMode};
}

function finalizeNdjsonState(
  state: SseParserState,
  onPartial?: (partialText: string) => void,
): {reply: string; parseMode: ParseMode} {
  const remaining = state.ndjsonBuffer.replace(/\r\n/g, '\n').trim();
  state.ndjsonBuffer = '';
  if (remaining) {
    processSseDataPayload(remaining, state, '', 'ndjson', onPartial);
  }

  const reply = normalizeReply(state.doneReply || state.fullReply);
  if (!reply) {
    throw new RemoteChatError('invalid_response', 'Stream remoto NDJSON finalizou sem resposta valida');
  }

  const parseMode: ParseMode = state.sawJsonPayload ? 'ndjson_json' : 'ndjson_text';
  return {reply, parseMode};
}

function parseStandardBody(
  rawBody: string,
  statusCode: number,
  url: string,
  requestDurationMs: number,
  totalDurationMs: number,
): {reply: string; parseMode: ParseMode} {
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    throw new RemoteChatError('invalid_response', 'Corpo da resposta remoto vazio', {
      statusCode,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  let payload: unknown = trimmedBody;
  let parseMode: ParseMode = 'text';
  try {
    payload = JSON.parse(trimmedBody);
    parseMode = 'json';
  } catch (_error) {
    payload = trimmedBody;
    parseMode = 'text';
  }

  if (isApiRejection(payload)) {
    throw new RemoteChatError('api_rejected', 'API retornou ok=false', {
      statusCode,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  const reply = extractReplyFromPayload(payload);
  if (!reply) {
    throw new RemoteChatError('invalid_response', 'Campo reply vazio ou invalido', {
      statusCode,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  return {reply, parseMode};
}

function isEventStreamContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes(STREAM_ACCEPT_CONTENT_TYPE);
}

async function sendRemoteChatMessageViaXhr(
  url: string,
  trimmedMessage: string,
  timeouts: RemoteChatTimeouts,
  requestStartedAt: number,
  onPartial?: (partialText: string) => void,
): Promise<RemoteChatSuccess> {
  return new Promise<RemoteChatSuccess>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(
        new RemoteChatError('network', 'XMLHttpRequest indisponivel no runtime atual', {
          url,
          totalDurationMs: nowMs() - requestStartedAt,
        }),
      );
      return;
    }

    const xhr = new XMLHttpRequest();
    const state = createSseParserState();
    let settled = false;
    let responseReceivedAt: number | null = null;
    let processedChars = 0;
    let sawFirstStreamChunk = false;
    let firstTokenTimeoutStarted = false;
    let streamChunkCount = 0;
    let streamBytes = 0;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
    let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
      if (timer) {
        clearTimeout(timer);
      }
      return null;
    };

    const clearAllTimers = () => {
      connectTimer = clearTimer(connectTimer);
      firstTokenTimer = clearTimer(firstTokenTimer);
      streamIdleTimer = clearTimer(streamIdleTimer);
    };

    const resolveOnce = (result: RemoteChatSuccess) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();
      resolve(result);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();
      reject(error);
    };

    const buildContext = (
      statusCode?: number,
      timeoutPhase?: TimeoutPhase,
    ): RemoteChatErrorContext => ({
      statusCode,
      url,
      requestDurationMs:
        responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : undefined,
      totalDurationMs: nowMs() - requestStartedAt,
      timeoutPhase,
    });

    const isSseResponse = (): boolean => {
      const contentType = String(xhr.getResponseHeader('content-type') || '');
      return isEventStreamContentType(contentType);
    };

    const abortAndRejectByTimeout = (timeoutMs: number, timeoutPhase: TimeoutPhase) => {
      rejectOnce(
        attachMissingContext(
          buildTimeoutError(
            url,
            requestStartedAt,
            timeoutMs,
            timeoutPhase,
            responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : undefined,
          ),
          buildContext(xhr.status || undefined, timeoutPhase),
        ),
      );
      try {
        xhr.abort();
      } catch (_error) {
        // noop
      }
    };

    const armFirstTokenTimer = () => {
      if (sawFirstStreamChunk || firstTokenTimeoutStarted) {
        return;
      }
      firstTokenTimeoutStarted = true;
      firstTokenTimer = setTimeout(() => {
        abortAndRejectByTimeout(timeouts.firstTokenTimeoutMs, 'first_token');
      }, timeouts.firstTokenTimeoutMs);
    };

    const armStreamIdleTimer = () => {
      if (!sawFirstStreamChunk) {
        return;
      }
      streamIdleTimer = clearTimer(streamIdleTimer);
      streamIdleTimer = setTimeout(() => {
        abortAndRejectByTimeout(timeouts.streamIdleTimeoutMs, 'stream_idle');
      }, timeouts.streamIdleTimeoutMs);
    };

    const markStreamProgress = () => {
      if (!sawFirstStreamChunk) {
        sawFirstStreamChunk = true;
        firstTokenTimer = clearTimer(firstTokenTimer);
        logInfo(
          TAG,
          'Primeiro chunk de stream recebido',
          [
            `url=${url}`,
            `requestDurationMs=${responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : nowMs() - requestStartedAt}`,
            `chars=${state.fullReply.length}`,
          ].join('\n'),
        );
      }
      armStreamIdleTimer();
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && responseReceivedAt === null) {
        responseReceivedAt = nowMs();
        connectTimer = clearTimer(connectTimer);
        armFirstTokenTimer();
      }
    };

    xhr.onprogress = () => {
      const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      if (text.length <= processedChars) {
        return;
      }
      const delta = text.slice(processedChars);
      processedChars = text.length;
      streamChunkCount += 1;
      streamBytes += delta.length;

      try {
        consumeFlexibleStreamChunk(delta, state, onPartial);
        if (delta.length > 0) {
          markStreamProgress();
        }

        if (streamChunkCount % 24 === 0) {
          logInfo(
            TAG,
            'Progresso do stream remoto',
            [
              `url=${url}`,
              `chunks=${streamChunkCount}`,
              `bytes=${streamBytes}`,
              `chars=${state.fullReply.length}`,
            ].join('\n'),
          );
        }
      } catch (error) {
        rejectOnce(
          error instanceof RemoteChatError
            ? attachMissingContext(error, buildContext(xhr.status))
            : new RemoteChatError('invalid_response', String(error), buildContext(xhr.status)),
        );
        try {
          xhr.abort();
        } catch (_error) {
          // noop
        }
      }
    };

    xhr.onerror = () => {
      rejectOnce(
        new RemoteChatError(
          'network',
          'Falha de conectividade ao acessar API remota',
          buildContext(xhr.status || undefined),
        ),
      );
    };

    xhr.ontimeout = () => {
      rejectOnce(
        attachMissingContext(
          buildTimeoutError(
            url,
            requestStartedAt,
            timeouts.totalTimeoutMs,
            'total',
            responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : undefined,
          ),
          buildContext(xhr.status || undefined, 'total'),
        ),
      );
    };

    xhr.onabort = () => {
      if (settled) {
        return;
      }
      rejectOnce(
        new RemoteChatError('network', 'Requisicao remota abortada', buildContext(xhr.status)),
      );
    };

    xhr.onload = () => {
      const statusCode = xhr.status;
      const requestDurationMs =
        responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : nowMs() - requestStartedAt;
      const totalDurationMs = nowMs() - requestStartedAt;

      if (statusCode < 200 || statusCode >= 300) {
        rejectOnce(
          new RemoteChatError('http', `HTTP ${statusCode}`, {
            statusCode,
            url,
            requestDurationMs,
            totalDurationMs,
          }),
        );
        return;
      }

      try {
        const responseText = typeof xhr.responseText === 'string' ? xhr.responseText : '';

        const streamDetected =
          isSseResponse() ||
          state.sawSsePayload ||
          state.sawNdjsonPayload ||
          state.sawDoneSentinel ||
          state.sawStreamSignal;

        if (streamDetected) {
          if (responseText.length > processedChars) {
            const delta = responseText.slice(processedChars);
            processedChars = responseText.length;
            streamChunkCount += 1;
            streamBytes += delta.length;
            consumeFlexibleStreamChunk(delta, state, onPartial);
            if (delta.length > 0) {
              markStreamProgress();
            }
          }

          const parsedStream = state.sawSsePayload
            ? finalizeSseState(state, onPartial)
            : finalizeNdjsonState(state, onPartial);
          const {reply, parseMode} = parsedStream;
          logInfo(
            TAG,
            'Stream remoto finalizado',
            [
              `url=${url}`,
              `status=${statusCode}`,
              `chunks=${streamChunkCount}`,
              `bytes=${streamBytes}`,
              `chars=${reply.length}`,
              `requestDurationMs=${requestDurationMs}`,
              `totalDurationMs=${totalDurationMs}`,
            ].join('\n'),
          );
          resolveOnce({
            reply,
            parseMode,
            requestDurationMs,
            totalDurationMs,
            statusCode,
          });
          return;
        }

        const parsed = parseStandardBody(
          responseText,
          statusCode,
          url,
          requestDurationMs,
          totalDurationMs,
        );
        onPartial?.(parsed.reply);

        resolveOnce({
          reply: parsed.reply,
          parseMode: parsed.parseMode,
          requestDurationMs,
          totalDurationMs,
          statusCode,
        });
      } catch (error) {
        rejectOnce(
          error instanceof RemoteChatError
            ? error
            : new RemoteChatError('invalid_response', `Falha ao processar resposta: ${String(error)}`, {
                statusCode,
                url,
                requestDurationMs,
                totalDurationMs,
              }),
        );
      }
    };

    try {
      xhr.open('POST', url, true);
      xhr.timeout = timeouts.totalTimeoutMs;
      xhr.setRequestHeader('Authorization', `Bearer ${API_TOKEN}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', STREAM_ACCEPT_CONTENT_TYPE);
      xhr.setRequestHeader('X-Stream', 'true');
      connectTimer = setTimeout(() => {
        abortAndRejectByTimeout(timeouts.connectionTimeoutMs, 'connection');
      }, timeouts.connectionTimeoutMs);
      xhr.send(JSON.stringify({message: trimmedMessage, stream: true}));
    } catch (error) {
      rejectOnce(
        new RemoteChatError('network', `Falha ao iniciar requisicao remota: ${String(error)}`, {
          url,
          totalDurationMs: nowMs() - requestStartedAt,
        }),
      );
    }
  });
}

async function sendRemoteChatMessageViaFetch(
  url: string,
  trimmedMessage: string,
  timeouts: RemoteChatTimeouts,
  requestStartedAt: number,
  onPartial?: (partialText: string) => void,
): Promise<RemoteChatSuccess> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let bodyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let timeoutPhase: TimeoutPhase | null = null;

  let response: Response;
  let responseReceivedAt: number | null = null;

  try {
    const fetchConfig: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: STREAM_ACCEPT_CONTENT_TYPE,
        'X-Stream': 'true',
      },
      body: JSON.stringify({message: trimmedMessage, stream: true}),
    };

    if (controller) {
      fetchConfig.signal = controller.signal;
      connectTimeoutId = setTimeout(() => {
        timeoutPhase = 'connection';
        controller.abort();
      }, timeouts.connectionTimeoutMs);
      response = await fetch(url, fetchConfig);
    } else {
      const timeoutPromise = new Promise<Response>((_resolve, reject) => {
        connectTimeoutId = setTimeout(() => {
          timeoutPhase = 'connection';
          reject(buildTimeoutError(url, requestStartedAt, timeouts.connectionTimeoutMs, 'connection'));
        }, timeouts.connectionTimeoutMs);
      });
      response = await Promise.race<Response>([fetch(url, fetchConfig), timeoutPromise]);
    }
    responseReceivedAt = nowMs();
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
    }
  } catch (error) {
    const context: RemoteChatErrorContext = {
      url,
      totalDurationMs: nowMs() - requestStartedAt,
      timeoutPhase: timeoutPhase ?? undefined,
    };

    if (error instanceof RemoteChatError) {
      throw attachMissingContext(error, context);
    }
    if (timeoutPhase || isAbortError(error)) {
      throw buildTimeoutError(
        url,
        requestStartedAt,
        timeoutPhase === 'connection' ? timeouts.connectionTimeoutMs : timeouts.totalTimeoutMs,
        timeoutPhase ?? 'total',
      );
    }
    if (isLikelyNetworkError(error)) {
      throw new RemoteChatError('network', 'Falha de conectividade ao acessar API remota', context);
    }
    throw new RemoteChatError('network', `Falha de rede inesperada: ${String(error)}`, context);
  } finally {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
    }
  }

  if (controller) {
    bodyTimeoutId = setTimeout(() => {
      timeoutPhase = 'first_token';
      controller.abort();
    }, timeouts.firstTokenTimeoutMs);
  }

  const statusCode = response.status;
  const requestDurationMs =
    responseReceivedAt !== null ? responseReceivedAt - requestStartedAt : nowMs() - requestStartedAt;
  const totalDurationMs = nowMs() - requestStartedAt;

  if (!response.ok) {
    if (bodyTimeoutId) {
      clearTimeout(bodyTimeoutId);
    }
    throw new RemoteChatError('http', `HTTP ${statusCode}`, {
      statusCode,
      url,
      requestDurationMs,
      totalDurationMs,
    });
  }

  let rawBody = '';
  const contentType = String(response.headers.get('content-type') || '');
  try {
    rawBody = await response.text();
  } catch (error) {
    if (timeoutPhase || isAbortError(error)) {
      throw new RemoteChatError(
        'timeout',
        `Timeout aguardando primeiro token apos ${timeouts.firstTokenTimeoutMs}ms`,
        {
          statusCode,
          url,
          requestDurationMs,
          totalDurationMs: nowMs() - requestStartedAt,
          timeoutPhase: timeoutPhase ?? 'first_token',
        },
      );
    }
    throw new RemoteChatError('invalid_response', `Falha ao ler corpo da resposta: ${String(error)}`, {
      statusCode,
      url,
      requestDurationMs,
      totalDurationMs: nowMs() - requestStartedAt,
    });
  } finally {
    if (bodyTimeoutId) {
      clearTimeout(bodyTimeoutId);
    }
    timeoutPhase = null;
  }
  if (isEventStreamContentType(contentType)) {
    const state = createSseParserState();
    consumeSseChunk(rawBody, state, onPartial);
    const parsedStream = finalizeSseState(state, onPartial);
    return {
      reply: parsedStream.reply,
      parseMode: parsedStream.parseMode,
      requestDurationMs,
      totalDurationMs,
      statusCode,
    };
  }

  const parsed = parseStandardBody(rawBody, statusCode, url, requestDurationMs, totalDurationMs);
  onPartial?.(parsed.reply);

  return {
    reply: parsed.reply,
    parseMode: parsed.parseMode,
    requestDurationMs,
    totalDurationMs,
    statusCode,
  };
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
  const timeoutMsBase =
    Number.isFinite(API_TIMEOUT_MS) && API_TIMEOUT_MS > 0 ? Math.floor(API_TIMEOUT_MS) : 90000;
  const timeouts = buildRemoteChatTimeouts(timeoutMsBase);

  logInfo(
    TAG,
    'Enviando mensagem para API remota',
    [
      `url=${url}`,
      `connectionTimeoutMs=${timeouts.connectionTimeoutMs}`,
      `firstTokenTimeoutMs=${timeouts.firstTokenTimeoutMs}`,
      `streamIdleTimeoutMs=${timeouts.streamIdleTimeoutMs}`,
      `totalTimeoutMs=${timeouts.totalTimeoutMs}`,
      `messageChars=${trimmedMessage.length}`,
      'streamPreferred=true',
    ].join('\n'),
  );

  let result: RemoteChatSuccess;
  if (typeof XMLHttpRequest !== 'undefined') {
    result = await sendRemoteChatMessageViaXhr(
      url,
      trimmedMessage,
      timeouts,
      requestStartedAt,
      onPartial,
    );
  } else {
    result = await sendRemoteChatMessageViaFetch(
      url,
      trimmedMessage,
      timeouts,
      requestStartedAt,
      onPartial,
    );
  }

  logInfo(
    TAG,
    'Resposta remota recebida com sucesso',
    [
      `url=${url}`,
      `status=${result.statusCode}`,
      `requestDurationMs=${result.requestDurationMs}`,
      `totalDurationMs=${result.totalDurationMs}`,
      `chars=${result.reply.length}`,
      `parseMode=${result.parseMode}`,
    ].join('\n'),
  );

  return result.reply;
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
        timeoutPhase: error.timeoutPhase,
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
