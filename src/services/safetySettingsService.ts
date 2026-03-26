import AsyncStorage from '@react-native-async-storage/async-storage';
import {logError, logInfo} from './logService';

const TAG = 'SafetySettingsService';
export const LOCAL_SAFETY_DISABLED_STORAGE_KEY = '@alfaai_local_safety_disabled';

let cachedLocalSafetyDisabled: boolean | null = null;
let pendingLoad: Promise<boolean> | null = null;
const listeners = new Set<(value: boolean) => void>();

function parseStoredFlag(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

function notifyListeners(value: boolean): void {
  listeners.forEach(listener => {
    try {
      listener(value);
    } catch (_error) {
      // Ignora erros de listener para manter robustez de notificacao.
    }
  });
}

export function getCachedLocalSafetyDisabled(): boolean {
  return cachedLocalSafetyDisabled === true;
}

export function subscribeLocalSafetyDisabled(
  listener: (value: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadLocalSafetyDisabled(): Promise<boolean> {
  if (cachedLocalSafetyDisabled !== null) {
    return cachedLocalSafetyDisabled;
  }

  if (pendingLoad) {
    return pendingLoad;
  }

  pendingLoad = (async () => {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_SAFETY_DISABLED_STORAGE_KEY);
      const parsed = parseStoredFlag(raw);
      cachedLocalSafetyDisabled = parsed;
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(TAG, 'Falha ao carregar configuracao de seguranca local', message);
      cachedLocalSafetyDisabled = false;
      return false;
    } finally {
      pendingLoad = null;
    }
  })();

  return pendingLoad;
}

export async function setLocalSafetyDisabled(disabled: boolean): Promise<void> {
  const value = disabled === true;
  const previousValue = cachedLocalSafetyDisabled === true;
  cachedLocalSafetyDisabled = value;
  notifyListeners(value);
  try {
    await AsyncStorage.setItem(LOCAL_SAFETY_DISABLED_STORAGE_KEY, value ? '1' : '0');
    logInfo(TAG, `Modo de teste (seguranca local desativada) atualizado: ${value}`);
  } catch (error) {
    cachedLocalSafetyDisabled = previousValue;
    notifyListeners(previousValue);
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Falha ao salvar configuracao de seguranca local', message);
    throw error;
  }
}
