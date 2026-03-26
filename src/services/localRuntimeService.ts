import {NativeModules, Platform} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {initLlama, releaseAllLlama, type LlamaContext} from 'llama.rn';
import {LOCAL_MODEL_MIN_VALID_SIZE_BYTES} from '../config/modelConfig';
import {Message} from '../types';
import * as LogService from './logService';

const TAG = 'LocalRuntimeService';
const EXPLICIT_RUNTIME_ENGINE = 'llama.rn';
const EXPLICIT_RUNTIME_STRATEGY = 'static-import';

const DEFAULT_CONTEXT_SIZE = 1024;
const DEFAULT_BATCH_SIZE = 128;
const DEFAULT_PREDICT_TOKENS = 192;
const MAX_PROMPT_MESSAGES = 12;
const MAX_PROMPT_CHARS = 8000;
const MIN_ANDROID_TOTAL_RAM_KB = 5 * 1024 * 1024;
const KNOWN_UNSUPPORTED_SOC_MARKERS = ['sm7450'];
const CPU_INFO_PATH = '/proc/cpuinfo';
const MEM_INFO_PATH = '/proc/meminfo';

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

interface ModelDownloadStateSnapshot {
  status: 'not_downloaded' | 'downloading' | 'ready' | 'error';
  filePath?: string;
}

type ModelDownloadStateLoader = () => Promise<ModelDownloadStateSnapshot>;

let runtimeState: RuntimeState = {status: 'not_loaded'};
let runtimeContext: RuntimeContext | null = null;
let runtimeLoadPromise: Promise<boolean> | null = null;
let modelDownloadStateLoader: ModelDownloadStateLoader | null = null;
let runtimeCompatibilityProbePromise: Promise<string | null> | null = null;

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
  if (
    message.includes("Cannot read property 'initContext' of null") ||
    message.includes("Cannot read properties of null (reading 'initContext')")
  ) {
    return 'Bridge nativo RNLlama nao encontrado. Rebuild nativo necessario apos instalar/autolink do llama.rn.';
  }
  if (
    message.includes("Cannot read property 'completion' of undefined") ||
    message.includes("Cannot read properties of undefined (reading 'completion')")
  ) {
    return 'Contexto do llama.rn veio invalido (completion indisponivel).';
  }
  return message;
}

function normalizeRuntimeErrorDetails(error: unknown): string {
  return normalizeRuntimeErrorMessage(toErrorDetails(error));
}

function loadNativeRNLlamaModule(): unknown | null {
  const modules = NativeModules as Record<string, unknown>;
  return modules.RNLlama ?? null;
}

function isNativeRNLlamaModuleAvailable(): boolean {
  return loadNativeRNLlamaModule() !== null;
}

function buildNativeBridgeUnavailableReason(): string {
  return 'Runtime explicito selecionado (llama.rn), mas NativeModules.RNLlama esta ausente. Rebuild do app necessario para carregar o bridge nativo.';
}

function normalizeModelPath(modelPath: string): string {
  if (modelPath.startsWith('file://')) {
    return modelPath;
  }
  return `file://${modelPath}`;
}

function normalizePromptMessageContent(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }
  return content.replace(/\s+/g, ' ').trim();
}

async function readProcFile(path: string): Promise<string | null> {
  try {
    const value = await ReactNativeBlobUtil.fs.readFile(path, 'utf8');
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function parseMemTotalKb(memInfoRaw: string | null): number | null {
  if (!memInfoRaw) {
    return null;
  }
  const match = memInfoRaw.match(/^MemTotal:\s+(\d+)\s+kB$/im);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPlatformConstant(constants: Record<string, unknown>, key: string): string {
  const value = constants[key];
  return typeof value === 'string' ? value : '';
}

function buildCompatibilityProbeText(cpuInfo: string | null): string {
  const constants = Platform.constants as unknown as Record<string, unknown>;
  const model = readPlatformConstant(constants, 'Model');
  const fingerprint = readPlatformConstant(constants, 'Fingerprint');
  const manufacturer = readPlatformConstant(constants, 'Manufacturer');
  const brand = readPlatformConstant(constants, 'Brand');
  return `${model}\n${manufacturer}\n${brand}\n${fingerprint}\n${cpuInfo ?? ''}`.toLowerCase();
}

async function detectAndroidRuntimeCompatibilityBlockReason(): Promise<string | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  const [cpuInfo, memInfo] = await Promise.all([
    readProcFile(CPU_INFO_PATH),
    readProcFile(MEM_INFO_PATH),
  ]);

  const totalMemKb = parseMemTotalKb(memInfo);
  if (totalMemKb !== null && totalMemKb < MIN_ANDROID_TOTAL_RAM_KB) {
    const totalMemGb = (totalMemKb / (1024 * 1024)).toFixed(1);
    const minMemGb = (MIN_ANDROID_TOTAL_RAM_KB / (1024 * 1024)).toFixed(1);
    return `Memoria insuficiente para inferencia local segura (${totalMemGb} GB detectado, minimo recomendado ${minMemGb} GB).`;
  }

  const probeText = buildCompatibilityProbeText(cpuInfo);
  const unsupportedSoc = KNOWN_UNSUPPORTED_SOC_MARKERS.find(marker => probeText.includes(marker));
  if (unsupportedSoc) {
    return `SoC Android com historico de crash nativo detectado (${unsupportedSoc.toUpperCase()}). Inferencia local foi bloqueada preventivamente para evitar fechamento do app.`;
  }

  return null;
}

async function getRuntimeCompatibilityBlockReason(): Promise<string | null> {
  if (!runtimeCompatibilityProbePromise) {
    runtimeCompatibilityProbePromise = detectAndroidRuntimeCompatibilityBlockReason();
  }
  return runtimeCompatibilityProbePromise;
}

interface RuntimeModelValidationResult {
  valid: boolean;
  size: number;
  reason?: string;
}

async function validateRuntimeModelFile(modelPath: string): Promise<RuntimeModelValidationResult> {
  try {
    const exists = await ReactNativeBlobUtil.fs.exists(modelPath);
    if (!exists) {
      return {
        valid: false,
        size: 0,
        reason: `Arquivo do modelo nao encontrado em ${modelPath}`,
      };
    }

    const stat = await ReactNativeBlobUtil.fs.stat(modelPath);
    const size = Number(stat.size) || 0;

    if (size < LOCAL_MODEL_MIN_VALID_SIZE_BYTES) {
      return {
        valid: false,
        size,
        reason:
          `Arquivo do modelo possivelmente truncado (${size} bytes). ` +
          `Minimo esperado: ${LOCAL_MODEL_MIN_VALID_SIZE_BYTES} bytes.`,
      };
    }

    return {valid: true, size};
  } catch (error) {
    return {
      valid: false,
      size: 0,
      reason: `Falha ao validar arquivo do modelo: ${toErrorMessage(error)}`,
    };
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
  const recentMessages = messages.slice(-MAX_PROMPT_MESSAGES);
  const promptBody = recentMessages
    .map(message => {
      const role =
        message.role === 'user'
          ? 'Usuario'
          : message.role === 'assistant'
          ? 'Assistente'
          : 'Sistema';
      return `${role}: ${normalizePromptMessageContent(message.content)}`;
    })
    .join('\n\n');

  if (!promptBody) {
    return 'Assistente:';
  }

  const prompt = `${promptBody}\n\nAssistente:`;
  if (prompt.length <= MAX_PROMPT_CHARS) {
    return prompt;
  }
  return prompt.slice(prompt.length - MAX_PROMPT_CHARS);
}

async function createLlamaRuntimeContext(modelPath: string): Promise<RuntimeContext> {
  const runtimeModelPath = normalizeModelPath(modelPath);

  logInfo(
    TAG,
    'Tentativa de criar contexto do runtime iniciada',
    `Engine: ${EXPLICIT_RUNTIME_ENGINE}\nModelo: ${runtimeModelPath}`,
  );

  const context = (await initLlama({
    model: runtimeModelPath,
    n_ctx: DEFAULT_CONTEXT_SIZE,
    n_batch: DEFAULT_BATCH_SIZE,
    use_mmap: true,
    use_mlock: false,
  })) as LlamaContext;

  if (!context || typeof context.completion !== 'function') {
    throw new Error('llama.rn sem metodo completion');
  }

  return {
    infer: async (prompt: string, nPredict: number) => {
      const completion = (await context.completion({
        prompt,
        n_predict: nPredict,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['\nUsuario:', '\nSistema:', '<|im_end|>', '</s>'],
      })) as {text?: unknown};

      const text = completion?.text;
      return typeof text === 'string' ? text.trim() : '';
    },
    release: async () => {
      await context.release();
    },
  };
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
    runtimeState = {
      status: 'loading',
      engine: EXPLICIT_RUNTIME_ENGINE,
    };
    logInfo(
      TAG,
      'Tentativa de carregar runtime local iniciada',
      `Engine selecionado: ${EXPLICIT_RUNTIME_ENGINE}\nEstrategia: ${EXPLICIT_RUNTIME_STRATEGY}`,
    );

    let resolvedModelPath: string | undefined;
    let validatedModelSize = 0;

    try {
      const compatibilityBlockReason = await getRuntimeCompatibilityBlockReason();
      if (compatibilityBlockReason) {
        runtimeState = {
          status: 'not_loaded',
          engine: EXPLICIT_RUNTIME_ENGINE,
          errorMessage: compatibilityBlockReason,
        };
        runtimeContext = null;
        logWarn(TAG, 'Runtime bloqueado por compatibilidade preventiva', compatibilityBlockReason);
        return false;
      }

      logInfo(TAG, 'Checagem de modelo instalado iniciada');
      const modelState = await loadModelDownloadStateFromLoader();
      resolvedModelPath = modelState.filePath;
      logInfo(
        TAG,
        'Checagem de modelo instalado concluida',
        `Status: ${modelState.status}\nPath: ${modelState.filePath ?? 'indisponivel'}`,
      );

      if (modelState.status !== 'ready' || !modelState.filePath) {
        runtimeState = {status: 'not_loaded'};
        runtimeContext = null;
        logWarn(
          TAG,
          'Runtime nao carregado: modelo indisponivel',
          `Status do modelo: ${modelState.status}`,
        );
        return false;
      }

      const modelValidation = await validateRuntimeModelFile(modelState.filePath);
      if (!modelValidation.valid) {
        runtimeState = {
          status: 'not_loaded',
          modelPath: modelState.filePath,
          engine: EXPLICIT_RUNTIME_ENGINE,
          errorMessage: modelValidation.reason,
        };
        runtimeContext = null;
        logWarn(
          TAG,
          'Runtime nao carregado: arquivo de modelo invalido para inferencia segura',
          `Motivo: ${modelValidation.reason ?? 'desconhecido'}`,
        );
        return false;
      }
      validatedModelSize = modelValidation.size;

      if (!isNativeRNLlamaModuleAvailable()) {
        const reason = buildNativeBridgeUnavailableReason();
        runtimeState = {
          status: 'not_loaded',
          modelPath: modelState.filePath,
          engine: EXPLICIT_RUNTIME_ENGINE,
          errorMessage: reason,
        };
        runtimeContext = null;
        logWarn(TAG, 'Runtime explicito indisponivel', reason);
        return false;
      }

      runtimeContext = await createLlamaRuntimeContext(modelState.filePath);
      runtimeState = {
        status: 'ready',
        modelPath: modelState.filePath,
        engine: EXPLICIT_RUNTIME_ENGINE,
      };
      logInfo(
        TAG,
        'Runtime local carregado com sucesso',
        `Engine: ${EXPLICIT_RUNTIME_ENGINE}\nModelo: ${modelState.filePath}\nTamanho validado: ${validatedModelSize} bytes`,
      );
      return true;
    } catch (error) {
      const errorMessage = normalizeRuntimeErrorMessage(toErrorMessage(error));
      runtimeState = {
        status: 'error',
        modelPath: resolvedModelPath,
        engine: EXPLICIT_RUNTIME_ENGINE,
        errorMessage,
      };
      runtimeContext = null;
      logError(TAG, 'Falha ao carregar runtime', normalizeRuntimeErrorDetails(error));
      return false;
    } finally {
      runtimeLoadPromise = null;
      logInfo(
        TAG,
        'Fluxo de carregamento de runtime finalizado',
        `Status final: ${runtimeState.status}\nEngine: ${runtimeState.engine ?? 'indisponivel'}`,
      );
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
    await releaseAllLlama();
  } catch (error) {
    logWarn(TAG, 'Falha ao liberar runtime', toErrorMessage(error));
  } finally {
    runtimeContext = null;
    runtimeState = {status: 'not_loaded'};
  }
}
