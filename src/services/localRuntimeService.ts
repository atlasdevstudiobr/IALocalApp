import {Message} from '../types';
import * as LogService from './logService';

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

interface ModelDownloadStateSnapshot {
  status: 'not_downloaded' | 'downloading' | 'ready' | 'error';
  filePath?: string;
}

type ModelDownloadStateLoader = () => Promise<ModelDownloadStateSnapshot>;

type MetroRequire = {
  (moduleId: number): unknown;
  resolveWeak?: (moduleName: string) => number;
};

const DEFAULT_CONTEXT_SIZE = 2048;
const DEFAULT_PREDICT_TOKENS = 384;

let runtimeState: RuntimeState = {status: 'not_loaded'};
let runtimeContext: RuntimeContext | null = null;
let runtimeLoadPromise: Promise<boolean> | null = null;
let modelDownloadStateLoader: ModelDownloadStateLoader | null = null;
const optionalRuntimeModuleErrorLogCache = new Set<string>();
const optionalRuntimeModuleSkipLogCache = new Set<string>();

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

function normalizeRuntimeErrorMessage(message: string): string {
  if (message.includes('Requiring unknown module "undefined"')) {
    return 'Bridge JS do runtime nao resolvido (dependencia opcional ausente ou link quebrado).';
  }
  if (
    message.includes("Cannot read property 'loadModelDownloadState' of undefined") ||
    message.includes("Cannot read properties of undefined (reading 'loadModelDownloadState')")
  ) {
    return 'Ligacao com ModelDownloadService invalida (loader de estado nao registrado).';
  }
  if (
    message.includes("Cannot read property 'logInfo' of undefined") ||
    message.includes("Cannot read properties of undefined (reading 'logInfo')")
  ) {
    return 'Logger interno do runtime veio indefinido (integracao JS/nativa inconsistente).';
  }
  return message;
}

function normalizeRuntimeErrorDetails(error: unknown): string {
  return normalizeRuntimeErrorMessage(toErrorDetails(error));
}

function reportOptionalRuntimeModuleSkip(
  engine: string,
  packageName: string,
  reason: string,
): void {
  const cacheKey = `${engine}:${packageName}:${reason}`;
  if (optionalRuntimeModuleSkipLogCache.has(cacheKey)) {
    return;
  }
  optionalRuntimeModuleSkipLogCache.add(cacheKey);
  logInfo(
    TAG,
    'Adapter opcional de runtime ignorado',
    `Engine: ${engine}\nPacote: ${packageName}\nMotivo: ${reason}`,
  );
}

function reportOptionalRuntimeRequireFailure(
  engine: string,
  packageName: string,
  error: unknown,
): void {
  const cacheKey = `${engine}:${packageName}`;
  if (optionalRuntimeModuleErrorLogCache.has(cacheKey)) {
    return;
  }
  optionalRuntimeModuleErrorLogCache.add(cacheKey);
  logWarn(
    TAG,
    'Require opcional de runtime falhou',
    `Engine: ${engine}\nPacote: ${packageName}\nMotivo: ${normalizeRuntimeErrorDetails(error)}`,
  );
}

function isNewArchitectureEnabled(): boolean {
  const scope = globalThis as {__turboModuleProxy?: unknown};
  return typeof scope.__turboModuleProxy === 'function';
}

function resolveOptionalRuntimeModule(engine: string, packageName: string): unknown | null {
  const metroRequire = require as MetroRequire;
  if (typeof metroRequire.resolveWeak !== 'function') {
    reportOptionalRuntimeModuleSkip(engine, packageName, 'resolveWeak indisponivel no runtime JS');
    return null;
  }

  try {
    const moduleId = metroRequire.resolveWeak(packageName);
    if (typeof moduleId !== 'number') {
      reportOptionalRuntimeModuleSkip(
        engine,
        packageName,
        `moduleId invalido retornado pelo bundler: ${String(moduleId)}`,
      );
      return null;
    }
    return metroRequire(moduleId);
  } catch (error) {
    reportOptionalRuntimeRequireFailure(engine, packageName, error);
    return null;
  }
}

async function loadModelDownloadStateFromLoader(): Promise<ModelDownloadStateSnapshot> {
  if (typeof modelDownloadStateLoader !== 'function') {
    throw new Error(
      'ModelDownloadService.loadModelDownloadState nao registrado em LocalRuntimeService',
    );
  }

  const state = await modelDownloadStateLoader();
  if (!state || typeof state !== 'object') {
    throw new Error('ModelDownloadService.loadModelDownloadState retornou estado invalido');
  }
  return state;
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
  if (!isNewArchitectureEnabled()) {
    reportOptionalRuntimeModuleSkip(
      'llama.rn',
      'llama.rn',
      'New Architecture desativada; adapter requer __turboModuleProxy',
    );
    return null;
  }

  const llamaRnModule = resolveOptionalRuntimeModule('llama.rn', 'llama.rn');
  if (!llamaRnModule) {
    return null;
  }

  try {
    const llamaRn = llamaRnModule as {
      initLlama?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      releaseAllLlama?: () => Promise<void>;
    };

    if (typeof llamaRn.initLlama !== 'function') {
      return null;
    }
    const initLlama = llamaRn.initLlama;

    return {
      engine: 'llama.rn',
      createContext: async (modelPath: string) => {
        const ctx = (await initLlama({
          model: modelPath,
          n_ctx: DEFAULT_CONTEXT_SIZE,
        })) as {
          completion?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          release?: () => Promise<void>;
        };

        if (typeof ctx.completion !== 'function') {
          throw new Error('llama.rn sem metodo completion');
        }
        const completionFn = ctx.completion;

        return {
          infer: async (prompt: string, nPredict: number) => {
            const completion = await completionFn({
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
  } catch (error) {
    reportOptionalRuntimeRequireFailure('llama.rn', 'llama.rn', error);
    return null;
  }
}

function getReactNativeLlamaAdapter(): RuntimeAdapter | null {
  const reactNativeLlamaModule = resolveOptionalRuntimeModule(
    'react-native-llama',
    'react-native-llama',
  );
  if (!reactNativeLlamaModule) {
    return null;
  }

  try {
    const reactNativeLlama = reactNativeLlamaModule as {
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
        const completionFn = ctx.completion;

        return {
          infer: async (prompt: string, nPredict: number) => {
            const completion = await completionFn({
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
  } catch (error) {
    reportOptionalRuntimeRequireFailure(
      'react-native-llama',
      'react-native-llama',
      error,
    );
    return null;
  }
}

function resolveRuntimeAdapters(): RuntimeAdapter[] {
  const adapters = [getLlamaRnAdapter(), getReactNativeLlamaAdapter()];
  return adapters.filter((adapter): adapter is RuntimeAdapter => adapter !== null);
}

export function getRuntimeState(): RuntimeState {
  return {...runtimeState};
}

export function registerModelDownloadStateLoader(loader: ModelDownloadStateLoader): void {
  modelDownloadStateLoader = loader;
  logInfo(TAG, 'Loader de estado do modelo registrado no runtime local');
}

export async function ensureRuntimeReady(): Promise<boolean> {
  if (runtimeState.status === 'ready' && runtimeContext) {
    logInfo(TAG, 'ensureRuntimeReady: runtime ja pronto, reutilizando contexto');
    return true;
  }

  if (runtimeLoadPromise) {
    logInfo(TAG, 'ensureRuntimeReady: carregamento em andamento, aguardando promessa existente');
    return runtimeLoadPromise;
  }

  runtimeLoadPromise = (async () => {
    runtimeState = {status: 'loading'};
    logInfo(TAG, 'Tentativa de carregar runtime local iniciada');

    try {
      logInfo(TAG, 'Checagem de modelo instalado iniciada');
      const modelState = await loadModelDownloadStateFromLoader();
      logInfo(
        TAG,
        'Checagem de modelo instalado concluida',
        `Status: ${modelState.status}\nPath: ${modelState.filePath ?? 'indisponivel'}`,
      );
      if (modelState.status !== 'ready' || !modelState.filePath) {
        runtimeState = {status: 'not_loaded'};
        logWarn(
          TAG,
          'Runtime nao carregado: modelo indisponivel',
          `Status do modelo: ${modelState.status}`,
        );
        return false;
      }

      const adapters = resolveRuntimeAdapters();
      if (adapters.length === 0) {
        runtimeState = {
          status: 'error',
          modelPath: modelState.filePath,
          errorMessage: 'Nenhum runtime local compativel encontrado',
        };
        logError(TAG, 'Falha ao carregar runtime', runtimeState.errorMessage);
        return false;
      }

      const adapterErrors: string[] = [];
      for (const adapter of adapters) {
        logInfo(
          TAG,
          'Tentativa de criar contexto do runtime iniciada',
          `Engine: ${adapter.engine}\nModelo: ${modelState.filePath}`,
        );

        try {
          runtimeContext = await adapter.createContext(modelState.filePath);
          logInfo(TAG, 'Tentativa de criar contexto do runtime concluida com sucesso');
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
        } catch (adapterError) {
          runtimeContext = null;
          const normalizedMessage = normalizeRuntimeErrorMessage(
            toErrorMessage(adapterError),
          );
          adapterErrors.push(`${adapter.engine}: ${normalizedMessage}`);
          logWarn(
            TAG,
            'Falha ao inicializar adapter de runtime; tentando proximo',
            `Engine: ${adapter.engine}\nMotivo: ${normalizeRuntimeErrorDetails(adapterError)}`,
          );
        }
      }

      runtimeState = {
        status: 'error',
        modelPath: modelState.filePath,
        errorMessage: `Nenhum adapter de runtime inicializou com sucesso.\n${adapterErrors.join('\n')}`,
      };
      logError(TAG, 'Falha ao carregar runtime', runtimeState.errorMessage);
      return false;
    } catch (error) {
      const errorMessage = normalizeRuntimeErrorMessage(toErrorMessage(error));
      runtimeState = {
        status: 'error',
        errorMessage,
      };
      runtimeContext = null;
      logError(TAG, 'Falha ao carregar runtime', normalizeRuntimeErrorDetails(error));
      return false;
    } finally {
      runtimeLoadPromise = null;
      logInfo(TAG, 'Fluxo de carregamento de runtime finalizado', `Status final: ${runtimeState.status}`);
    }
  })();

  return runtimeLoadPromise;
}

export async function inferWithLocalRuntime(messages: Message[]): Promise<string> {
  const prompt = buildPrompt(messages);
  if (!runtimeContext) {
    logError(TAG, 'Inferencia solicitada sem runtimeContext');
    throw new Error('Runtime local indisponivel para inferencia');
  }

  logInfo(
    TAG,
    'Iniciando inferencia local',
    `Mensagens: ${messages.length}\nEngine: ${runtimeState.engine ?? 'desconhecida'}`,
  );
  try {
    const response = await runtimeContext.infer(prompt, DEFAULT_PREDICT_TOKENS);
    if (response === null || response === undefined) {
      logWarn(TAG, 'Retorno da inferencia veio null/undefined');
      throw new Error('Inferencia retornou valor nulo/indefinido');
    }
    logInfo(TAG, 'Retorno da inferencia local concluido', `Tamanho bruto: ${response.length}`);
    return response;
  } catch (error) {
    logError(TAG, 'Erro durante inferencia local', normalizeRuntimeErrorDetails(error));
    throw error;
  }
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
