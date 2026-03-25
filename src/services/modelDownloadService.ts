import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBlobUtil, {
  FetchBlobResponse,
  StatefulPromise,
} from 'react-native-blob-util';
import {ModelStatus} from '../types';
import {
  LOCAL_MODEL_DISPLAY_NAME,
  LOCAL_MODEL_DOWNLOAD_URL,
  LOCAL_MODEL_ESTIMATED_SIZE_BYTES,
  LOCAL_MODEL_FILE_NAME,
  LOCAL_MODEL_MIN_VALID_SIZE_BYTES,
} from '../config/modelConfig';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'ModelDownloadService';
const STORAGE_KEY = '@alfaai_model_download_state';
const MODEL_DIR_NAME = 'models';

type DownloadOutcome = 'success' | 'error' | 'cancelled';

export interface ModelDownloadState {
  name: string;
  status: ModelStatus;
  downloadUrl: string;
  filePath: string;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage?: string;
}

interface DownloadProgressUpdate {
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
}

interface StartModelDownloadParams {
  onProgress?: (update: DownloadProgressUpdate) => void;
  downloadUrl?: string;
}

let activeDownloadTask: StatefulPromise<FetchBlobResponse> | null = null;
let lastLoggedProgress = 0;

function getModelDirectoryPath(): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${MODEL_DIR_NAME}`;
}

function getModelFilePath(): string {
  return `${getModelDirectoryPath()}/${LOCAL_MODEL_FILE_NAME}`;
}

function buildDefaultState(): ModelDownloadState {
  return {
    name: LOCAL_MODEL_DISPLAY_NAME,
    status: 'not_downloaded',
    downloadUrl: LOCAL_MODEL_DOWNLOAD_URL,
    filePath: getModelFilePath(),
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: LOCAL_MODEL_ESTIMATED_SIZE_BYTES,
  };
}

async function persistModelState(state: ModelDownloadState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseStoredState(raw: string | null): Partial<ModelDownloadState> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Partial<ModelDownloadState>;
  } catch {
    return {};
  }
}

async function ensureModelDirectory(): Promise<void> {
  const dir = getModelDirectoryPath();
  const exists = await ReactNativeBlobUtil.fs.isDir(dir);
  if (!exists) {
    await ReactNativeBlobUtil.fs.mkdir(dir);
  }
}

async function safelyDeleteFile(path: string): Promise<void> {
  try {
    const exists = await ReactNativeBlobUtil.fs.exists(path);
    if (exists) {
      await ReactNativeBlobUtil.fs.unlink(path);
    }
  } catch (_error) {
    // Best-effort cleanup only.
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelledError(error: unknown): boolean {
  if (error instanceof ReactNativeBlobUtil.CanceledFetchError) {
    return true;
  }

  const message = toErrorMessage(error).toLowerCase();
  return message.includes('cancel') || message.includes('aborted');
}

async function readFileSize(path: string): Promise<number> {
  const stats = await ReactNativeBlobUtil.fs.stat(path);
  return Number(stats.size) || 0;
}

async function validateModelFile(path: string): Promise<{valid: boolean; size: number}> {
  const exists = await ReactNativeBlobUtil.fs.exists(path);
  if (!exists) {
    return {valid: false, size: 0};
  }

  const size = await readFileSize(path);
  if (size < LOCAL_MODEL_MIN_VALID_SIZE_BYTES) {
    return {valid: false, size};
  }

  return {valid: true, size};
}

function buildDownloadedState(size: number): ModelDownloadState {
  return {
    name: LOCAL_MODEL_DISPLAY_NAME,
    status: 'ready',
    downloadUrl: LOCAL_MODEL_DOWNLOAD_URL,
    filePath: getModelFilePath(),
    downloadProgress: 100,
    downloadedBytes: size,
    totalBytes: Math.max(size, LOCAL_MODEL_ESTIMATED_SIZE_BYTES),
  };
}

export async function loadModelDownloadState(): Promise<ModelDownloadState> {
  try {
    await ensureModelDirectory();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const stored = parseStoredState(raw);

    const state: ModelDownloadState = {
      ...buildDefaultState(),
      ...stored,
      filePath: getModelFilePath(),
    };

    const validation = await validateModelFile(state.filePath);

    if (validation.valid) {
      const downloadedState = {
        ...state,
        status: 'ready' as const,
        downloadProgress: 100,
        downloadedBytes: validation.size,
        totalBytes: Math.max(validation.size, state.totalBytes || 0),
        errorMessage: undefined,
      };
      await persistModelState(downloadedState);
      logInfo(
        TAG,
        'Modelo local detectado no armazenamento',
        `Path: ${downloadedState.filePath}\nTamanho: ${validation.size} bytes`,
      );
      return downloadedState;
    }

    if (validation.size > 0) {
      logWarn(
        TAG,
        'Arquivo de modelo encontrado, mas invalido',
        `Path: ${state.filePath}\nTamanho detectado: ${validation.size} bytes`,
      );
    }

    if (state.status === 'downloading') {
      state.status = 'not_downloaded';
      state.downloadProgress = 0;
      state.downloadedBytes = 0;
      state.errorMessage = undefined;
    }

    await persistModelState(state);
    return state;
  } catch (error) {
    const message = toErrorMessage(error);
    logError(TAG, 'Falha ao carregar estado do modelo', message);
    return buildDefaultState();
  }
}

export function isModelDownloadInProgress(): boolean {
  return activeDownloadTask !== null;
}

export async function cancelModelDownload(): Promise<void> {
  if (!activeDownloadTask) {
    return;
  }

  logWarn(TAG, 'Cancelamento solicitado para o download do modelo');
  activeDownloadTask.cancel();
}

async function finalizeState(
  baseState: ModelDownloadState,
  outcome: DownloadOutcome,
  errorMessage?: string,
): Promise<ModelDownloadState> {
  if (outcome === 'success') {
    const size = await readFileSize(baseState.filePath);
    const doneState = {
      ...baseState,
      ...buildDownloadedState(size),
      errorMessage: undefined,
    };

    await persistModelState(doneState);
    logInfo(TAG, 'Download do modelo concluido com sucesso', `Path: ${doneState.filePath}`);
    return doneState;
  }

  await safelyDeleteFile(baseState.filePath);

  if (outcome === 'cancelled') {
    const cancelledState: ModelDownloadState = {
      ...baseState,
      status: 'not_downloaded',
      downloadProgress: 0,
      downloadedBytes: 0,
      errorMessage: undefined,
    };

    await persistModelState(cancelledState);
    logWarn(TAG, 'Download do modelo cancelado pelo usuario');
    return cancelledState;
  }

  const failedState: ModelDownloadState = {
    ...baseState,
    status: 'error',
    errorMessage: 'Falha ao baixar o modelo. Verifique conexao e tente novamente.',
  };

  await persistModelState(failedState);
  logError(
    TAG,
    'Falha no download do modelo',
    errorMessage || 'Erro desconhecido no download',
  );
  return failedState;
}

export async function startModelDownload(
  params: StartModelDownloadParams = {},
): Promise<ModelDownloadState> {
  const currentState = await loadModelDownloadState();

  if (activeDownloadTask) {
    return currentState;
  }

  const downloadUrl = params.downloadUrl || currentState.downloadUrl || LOCAL_MODEL_DOWNLOAD_URL;

  const startState: ModelDownloadState = {
    ...currentState,
    status: 'downloading',
    downloadUrl,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: currentState.totalBytes || LOCAL_MODEL_ESTIMATED_SIZE_BYTES,
    errorMessage: undefined,
  };

  await persistModelState(startState);
  await ensureModelDirectory();
  await safelyDeleteFile(startState.filePath);

  logInfo(
    TAG,
    'Iniciando download do modelo',
    `URL: ${downloadUrl}\nDestino: ${startState.filePath}`,
  );

  lastLoggedProgress = 0;

  try {
    activeDownloadTask = ReactNativeBlobUtil.config({
      path: startState.filePath,
      overwrite: true,
      fileCache: true,
    })
      .fetch('GET', downloadUrl)
      .progress({interval: 300}, (received, total) => {
        const safeReceived = Number(received) || 0;
        const safeTotal = Number(total) || startState.totalBytes;
        const progress = safeTotal > 0 ? Math.min(100, (safeReceived / safeTotal) * 100) : 0;

        params.onProgress?.({
          downloadProgress: progress,
          downloadedBytes: safeReceived,
          totalBytes: safeTotal,
        });

        if (progress - lastLoggedProgress >= 5 || progress === 100) {
          lastLoggedProgress = progress;
          logInfo(
            TAG,
            'Progresso do download',
            `${progress.toFixed(1)}% (${safeReceived}/${safeTotal} bytes)`,
          );
        }
      });

    const response = await activeDownloadTask;
    const statusCode = response.info().status;

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode}`);
    }

    const validation = await validateModelFile(startState.filePath);
    if (!validation.valid) {
      throw new Error(
        `Arquivo baixado invalido. Tamanho detectado: ${validation.size} bytes`,
      );
    }

    return await finalizeState(startState, 'success');
  } catch (error) {
    if (isCancelledError(error)) {
      return await finalizeState(startState, 'cancelled');
    }

    const message = toErrorMessage(error);
    return await finalizeState(startState, 'error', message);
  } finally {
    activeDownloadTask = null;
  }
}
