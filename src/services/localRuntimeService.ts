import {Message} from '../types';
import {loadModelDownloadState} from './modelDownloadService';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'LocalRuntimeService';

export type RuntimeStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

interface RuntimeState {
  status: RuntimeStatus;
  modelPath?: string;
  engine?: string;
  errorMessage?: string;
}

interface RuntimeContext {
  infer: (prompt: string, nPredict: number) => Promise<string>;
  release?: () => Promise<void> | void;
}

interface RuntimeAdapter {
  engine: string;
  createContext: (modelPath: string) => Promise<RuntimeContext>;
}

const DEFAULT_CONTEXT_SIZE = 2048;
const DEFAULT_PREDICT_TOKENS = 384;

let runtimeState: RuntimeState = {status: 'not_loaded'};
let runtimeContext: RuntimeContext | null = null;
let runtimeLoadPromise: Promise<boolean> | null = null;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPrompt(messages: Message[]): string {
  const prompt = messages
    .map(message => {
      const role =
        message.role === 'user'
          ? 'Usuario'
          : message.role === 'assistant'
          ? 'Assistente'
          : 'Sistema';
      return `${role}: ${message.content.trim()}`;
    })
    .join('\n\n');

  return `${prompt}\n\nAssistente:`;
}

function getLlamaRnAdapter(): RuntimeAdapter | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const llamaRn = require('llama.rn') as {
      initLlama?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      releaseAllLlama?: () => Promise<void>;
    };

    if (typeof llamaRn.initLlama !== 'function') {
      return null;
    }

    return {
      engine: 'llama.rn',
      createContext: async (modelPath: string) => {
        const ctx = (await llamaRn.initLlama({
          model: modelPath,
          n_ctx: DEFAULT_CONTEXT_SIZE,
        })) as {
          completion?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          release?: () => Promise<void>;
        };

        if (typeof ctx.completion !== 'function') {
          throw new Error('llama.rn sem metodo completion');
        }

        return {
          infer: async (prompt: string, nPredict: number) => {
            const completion = await ctx.completion?.({
              prompt,
              n_predict: nPredict,
              temperature: 0.7,
            });
            const text = completion?.text;
            return typeof text === 'string' ? text.trim() : '';
          },
          release: async () => {
            if (typeof ctx.release === 'function') {
              await ctx.release();
              return;
            }
            if (typeof llamaRn.releaseAllLlama === 'function') {
              await llamaRn.releaseAllLlama();
            }
          },
        };
      },
    };
  } catch {
    return null;
  }
}

function getReactNativeLlamaAdapter(): RuntimeAdapter | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reactNativeLlama = require('react-native-llama') as {
      LlamaContext?: {
        create?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    };

    const create = reactNativeLlama.LlamaContext?.create;
    if (typeof create !== 'function') {
      return null;
    }

    return {
      engine: 'react-native-llama',
      createContext: async (modelPath: string) => {
        const ctx = (await create({
          model: modelPath,
          n_ctx: DEFAULT_CONTEXT_SIZE,
        })) as {
          completion?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          release?: () => Promise<void>;
        };

        if (typeof ctx.completion !== 'function') {
          throw new Error('react-native-llama sem metodo completion');
        }

        return {
          infer: async (prompt: string, nPredict: number) => {
            const completion = await ctx.completion?.({
              prompt,
              n_predict: nPredict,
              temperature: 0.7,
            });
            const text = completion?.text;
            return typeof text === 'string' ? text.trim() : '';
          },
          release: async () => {
            await ctx.release?.();
          },
        };
      },
    };
  } catch {
    return null;
  }
}

function resolveRuntimeAdapter(): RuntimeAdapter | null {
  return getLlamaRnAdapter() || getReactNativeLlamaAdapter();
}

export function getRuntimeState(): RuntimeState {
  return {...runtimeState};
}

export async function ensureRuntimeReady(): Promise<boolean> {
  if (runtimeState.status === 'ready' && runtimeContext) {
    return true;
  }

  if (runtimeLoadPromise) {
    return runtimeLoadPromise;
  }

  runtimeLoadPromise = (async () => {
    runtimeState = {status: 'loading'};
    logInfo(TAG, 'Tentando carregar runtime local');

    try {
      const modelState = await loadModelDownloadState();
      if (modelState.status !== 'ready' || !modelState.filePath) {
        runtimeState = {status: 'not_loaded'};
        logWarn(
          TAG,
          'Runtime nao carregado: modelo indisponivel',
          `Status do modelo: ${modelState.status}`,
        );
        return false;
      }

      const adapter = resolveRuntimeAdapter();
      if (!adapter) {
        runtimeState = {
          status: 'error',
          modelPath: modelState.filePath,
          errorMessage: 'Nenhum runtime local compativel encontrado',
        };
        logError(TAG, 'Falha ao carregar runtime', runtimeState.errorMessage);
        return false;
      }

      runtimeContext = await adapter.createContext(modelState.filePath);
      runtimeState = {
        status: 'ready',
        modelPath: modelState.filePath,
        engine: adapter.engine,
      };
      logInfo(
        TAG,
        'Runtime local carregado com sucesso',
        `Engine: ${adapter.engine}\nModelo: ${modelState.filePath}`,
      );
      return true;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      runtimeState = {
        status: 'error',
        errorMessage,
      };
      runtimeContext = null;
      logError(TAG, 'Falha ao carregar runtime', errorMessage);
      return false;
    } finally {
      runtimeLoadPromise = null;
    }
  })();

  return runtimeLoadPromise;
}

export async function inferWithLocalRuntime(messages: Message[]): Promise<string> {
  const prompt = buildPrompt(messages);
  if (!runtimeContext) {
    throw new Error('Runtime local indisponivel para inferencia');
  }

  logInfo(
    TAG,
    'Iniciando inferencia local',
    `Mensagens: ${messages.length}\nEngine: ${runtimeState.engine ?? 'desconhecida'}`,
  );
  return runtimeContext.infer(prompt, DEFAULT_PREDICT_TOKENS);
}

export async function releaseRuntime(): Promise<void> {
  if (!runtimeContext) {
    runtimeState = {status: 'not_loaded'};
    return;
  }

  try {
    await runtimeContext.release?.();
  } catch (error) {
    logWarn(TAG, 'Falha ao liberar runtime', toErrorMessage(error));
  } finally {
    runtimeContext = null;
    runtimeState = {status: 'not_loaded'};
  }
}
