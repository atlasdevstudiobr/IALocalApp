import {Message} from '../types';
import {logError, logInfo, logWarn} from './logService';
import {
  ensureRuntimeReady,
  getRuntimeState,
  inferWithLocalRuntime,
  releaseRuntime,
  RuntimeStatus,
} from './localRuntimeService';

const TAG = 'AIService';

/**
 * Stub response returned when no model is loaded.
 */
const STUB_RESPONSE =
  '\u2699\uFE0F Modelo local ainda nao instalado. Acesse Configuracoes para instalar o modelo Qwen2.5-3B.';

/**
 * Generates a response from the AI model.
 *
 * Usa runtime local quando disponivel e faz fallback para stub em caso de falha.
 *
 * @param messages - The conversation history to send to the model
 * @returns Promise resolving to the assistant's response text
 */
export async function generateResponse(messages: Message[]): Promise<string> {
  const lastMessage = messages[messages.length - 1];
  logInfo(
    TAG,
    `generateResponse called with ${messages.length} message(s)`,
    `Last message role: ${lastMessage?.role ?? 'none'}`,
  );

  const runtimeReady = await ensureRuntimeReady();
  if (!runtimeReady) {
    const state = getRuntimeState();
    logWarn(
      TAG,
      'Runtime indisponivel, retornando fallback stub',
      `Status runtime: ${state.status}\nMotivo: ${state.errorMessage ?? 'modelo nao carregado'}`,
    );
    return STUB_RESPONSE;
  }

  try {
    const response = await inferWithLocalRuntime(messages);
    if (!response) {
      logWarn(TAG, 'Inferencia vazia, retornando fallback stub');
      return STUB_RESPONSE;
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Falha na inferencia local, retornando fallback stub', message);
    return STUB_RESPONSE;
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
