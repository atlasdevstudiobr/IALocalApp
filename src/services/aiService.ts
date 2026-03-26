import {Message} from '../types';
import * as LogService from './logService';
import {loadModelDownloadState} from './modelDownloadService';
import {
  ensureRuntimeReady,
  getRuntimeState,
  inferWithLocalRuntime,
  registerModelDownloadStateLoader,
  releaseRuntime,
  RuntimeStatus,
} from './localRuntimeService';

const TAG = 'AIService';

/**
 * Stub response returned when no model is loaded.
 */
const STUB_RESPONSE =
  '\u2699\uFE0F Modelo local ainda nao instalado. Acesse Configuracoes para instalar o modelo Qwen2.5-3B.';
const RUNTIME_FAILURE_FALLBACK =
  'Falha ao carregar o runtime local. Veja os logs.';
const CASUAL_SHORT_REPLY_PATTERN =
  /^(oi+|ola+|opa+|e ai+|tudo bem|beleza|blz|valeu|obrigad[oa]|que maluquice.*|que doidera.*)[!.?\s]*$/i;
let runtimeBindingsInitialized = false;

function logInfo(tag: string, message: string, details?: string): void {
  try {
    if (typeof LogService.logInfo === 'function') {
      void LogService.logInfo(tag, message, details);
      return;
    }
  } catch (_error) {
    // Fallback de logger para evitar quebra estrutural.
  }
  console.info(`[${tag}] ${message}${details ? `\n${details}` : ''}`);
}

function logWarn(tag: string, message: string, details?: string): void {
  try {
    if (typeof LogService.logWarn === 'function') {
      void LogService.logWarn(tag, message, details);
      return;
    }
  } catch (_error) {
    // Fallback de logger para evitar quebra estrutural.
  }
  console.warn(`[${tag}] ${message}${details ? `\n${details}` : ''}`);
}

function logError(tag: string, message: string, details?: string): void {
  try {
    if (typeof LogService.logError === 'function') {
      void LogService.logError(tag, message, details);
      return;
    }
  } catch (_error) {
    // Fallback de logger para evitar quebra estrutural.
  }
  console.error(`[${tag}] ${message}${details ? `\n${details}` : ''}`);
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

function normalizeModelResponse(content: string): string {
  if (!content) {
    return '';
  }

  let normalized = content.trim();
  normalized = normalized.replace(/^(assistente|assistant)\s*:\s*/i, '').trim();

  const leakedRoleMatch = normalized.search(/\n\s*(usuario|sistema|user|system)\s*:/i);
  if (leakedRoleMatch >= 0) {
    normalized = normalized.slice(0, leakedRoleMatch).trim();
  }

  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

function getLastUserContent(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && typeof messages[index].content === 'string') {
      return messages[index].content.trim();
    }
  }
  return '';
}

function keepCasualReplyConcise(response: string, lastUserContent: string): string {
  if (!response || !lastUserContent) {
    return response;
  }

  if (!CASUAL_SHORT_REPLY_PATTERN.test(lastUserContent.trim().toLowerCase())) {
    return response;
  }
  if (response.length <= 220) {
    return response;
  }

  const firstParagraph = response.split(/\n{2,}/)[0].trim();
  if (firstParagraph.length >= 16 && firstParagraph.length <= 220) {
    return firstParagraph;
  }

  const firstSentence = response.match(/^(.{1,220}?[.!?])(?:\s|$)/);
  if (firstSentence?.[1]) {
    return firstSentence[1].trim();
  }

  return `${response.slice(0, 217).trim()}...`;
}

function ensureRuntimeBindings(): void {
  if (runtimeBindingsInitialized) {
    return;
  }

  if (typeof loadModelDownloadState !== 'function') {
    logError(
      TAG,
      'Ligacao do runtime local falhou',
      'ModelDownloadService.loadModelDownloadState indisponivel',
    );
    return;
  }

  registerModelDownloadStateLoader(loadModelDownloadState);
  runtimeBindingsInitialized = true;
  logInfo(TAG, 'Ligacao com ModelDownloadService registrada no LocalRuntimeService');
}

export async function warmupRuntimeSafely(): Promise<void> {
  ensureRuntimeBindings();
  logInfo(TAG, 'Warmup seguro do runtime iniciado');
  try {
    const ready = await ensureRuntimeReady();
    logInfo(TAG, 'Warmup seguro do runtime concluido', `Runtime pronto: ${ready}`);
  } catch (error) {
    logError(TAG, 'Warmup seguro do runtime falhou', toErrorDetails(error));
  }
}

/**
 * Generates a response from the AI model.
 *
 * Usa runtime local quando disponivel e faz fallback para stub em caso de falha.
 *
 * @param messages - The conversation history to send to the model
 * @returns Promise resolving to the assistant's response text
 */
export async function generateResponse(messages: Message[]): Promise<string> {
  ensureRuntimeBindings();
  const lastMessage = messages[messages.length - 1];
  logInfo(
    TAG,
    `Entrada no AIService.generateResponse com ${messages.length} mensagem(ns)`,
    `Last message role: ${lastMessage?.role ?? 'none'}`,
  );

  let runtimeReady = false;
  try {
    logInfo(TAG, 'Checagem de runtime/modelo iniciada');
    runtimeReady = await ensureRuntimeReady();
    logInfo(TAG, 'Checagem de runtime/modelo concluida', `Runtime pronto: ${runtimeReady}`);
  } catch (error) {
    logError(TAG, 'Erro ao checar/carregar runtime', toErrorDetails(error));
    return RUNTIME_FAILURE_FALLBACK;
  }

  if (!runtimeReady) {
    const state = getRuntimeState();
    const detail = `Status runtime: ${state.status}\nMotivo: ${
      state.errorMessage ?? 'modelo nao carregado'
    }`;
    const modelUnavailable =
      state.status === 'not_loaded' && !state.modelPath && !state.errorMessage;
    if (modelUnavailable) {
      logWarn(TAG, 'Runtime indisponivel por modelo nao carregado, fallback de modelo', detail);
      return STUB_RESPONSE;
    }
    logWarn(TAG, 'Runtime indisponivel, fallback de falha de runtime', detail);
    return RUNTIME_FAILURE_FALLBACK;
  }

  try {
    logInfo(TAG, 'Inicio da inferencia via runtime local');
    const response = await inferWithLocalRuntime(messages);
    if (typeof response !== 'string') {
      logWarn(
        TAG,
        'Inferencia retornou valor invalido (nao string), aplicando fallback',
        `Tipo retornado: ${typeof response}`,
      );
      return RUNTIME_FAILURE_FALLBACK;
    }
    const lastUserContent = getLastUserContent(messages);
    const normalizedResponse = normalizeModelResponse(response);
    const finalResponse = keepCasualReplyConcise(normalizedResponse, lastUserContent);
    if (!finalResponse.trim()) {
      logWarn(TAG, 'Inferencia retornou string vazia, aplicando fallback');
      return RUNTIME_FAILURE_FALLBACK;
    }
    logInfo(
      TAG,
      'Retorno da inferencia recebido',
      `Tamanho bruto: ${response.length}\nTamanho final: ${finalResponse.length}`,
    );
    return finalResponse;
  } catch (error) {
    logError(TAG, 'Falha na inferencia local, aplicando fallback seguro', toErrorDetails(error));
    return RUNTIME_FAILURE_FALLBACK;
  }
}

/**
 * Checks whether the AI model is currently loaded and ready.
 */
export function isAIReady(): boolean {
  return getRuntimeState().status === 'ready';
}

/**
 * Mantido por compatibilidade com chamadas antigas.
 */
export function setModelLoaded(loaded: boolean): void {
  ensureRuntimeBindings();
  if (loaded) {
    void ensureRuntimeReady();
  } else {
    void releaseRuntime();
  }
  logInfo(TAG, `setModelLoaded called (compat): ${loaded}`);
}

export function getAIRuntimeStatus(): RuntimeStatus {
  return getRuntimeState().status;
}

/**
 * Returns model info for display purposes.
 */
export function getModelInfo() {
  ensureRuntimeBindings();
  const runtime = getRuntimeState();
  return {
    name: 'Qwen2.5-3B-Instruct-Q4_K_M',
    displayName: 'Qwen2.5-3B-Instruct Q4_K_M',
    sizeGB: 2.0,
    isLoaded: runtime.status === 'ready',
    runtimeStatus: runtime.status,
    runtimeEngine: runtime.engine,
    runtimeError: runtime.errorMessage,
  };
}

ensureRuntimeBindings();
