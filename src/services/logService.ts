import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppLog} from '../types';
import {generateId, formatDate} from '../utils/helpers';

const MAX_MEMORY_LOGS = 200;
const MAX_STORAGE_LOGS = 100;
const STORAGE_KEY = '@alfaai_logs';
const LOG_PERSIST_DEBOUNCE_MS = 1200;

type LogListener = (logs: AppLog[]) => void;

let memoryLogs: AppLog[] = [];
const listeners: Set<LogListener> = new Set();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function notifyListeners(): void {
  listeners.forEach(listener => listener([...memoryLogs]));
}

function schedulePersistLogs(delayMs = LOG_PERSIST_DEBOUNCE_MS): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistLogsSnapshot();
  }, delayMs);
}

async function persistLogsSnapshot(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryLogs.slice(0, MAX_STORAGE_LOGS)));
  } catch (_e) {
    // Silently ignore storage errors for logs
  }
}

/**
 * Adds a log entry to memory and persists to AsyncStorage.
 */
export async function addLog(
  level: AppLog['level'],
  tag: string,
  message: string,
  details?: string,
): Promise<void> {
  const log: AppLog = {
    id: generateId(),
    level,
    tag,
    message,
    timestamp: Date.now(),
    details,
  };

  memoryLogs = [log, ...memoryLogs].slice(0, MAX_MEMORY_LOGS);
  notifyListeners();
  schedulePersistLogs();
}

/**
 * Returns a copy of the current in-memory logs.
 */
export function getLogs(): AppLog[] {
  return [...memoryLogs];
}

/**
 * Clears all logs from memory and storage.
 */
export async function clearLogs(): Promise<void> {
  memoryLogs = [];
  notifyListeners();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (_e) {
    // Ignore
  }
}

/**
 * Exports logs as a formatted text string suitable for sharing.
 */
export function exportLogs(): string {
  if (memoryLogs.length === 0) {
    return 'Nenhum log disponivel.';
  }

  return memoryLogs
    .map(log => {
      const time = formatDate(log.timestamp);
      const level = log.level.toUpperCase().padEnd(5);
      const details = log.details ? `\n  Detalhes: ${log.details}` : '';
      return `[${time}] ${level} [${log.tag}] ${log.message}${details}`;
    })
    .join('\n');
}

/**
 * Loads persisted logs from AsyncStorage into memory.
 * Should be called once on app start.
 */
export async function loadPersistedLogs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: AppLog[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryLogs = parsed;
        notifyListeners();
      }
    }
  } catch (_e) {
    // Ignore
  }
}

/**
 * Subscribe to log updates.
 * Returns an unsubscribe function.
 */
export function subscribeToLogs(listener: LogListener): () => void {
  listeners.add(listener);
  // Immediately call with current logs
  listener([...memoryLogs]);
  return () => {
    listeners.delete(listener);
  };
}

// Convenience helpers
export const logInfo = (tag: string, message: string, details?: string) =>
  addLog('info', tag, message, details);

export const logWarn = (tag: string, message: string, details?: string) =>
  addLog('warn', tag, message, details);

export const logError = (tag: string, message: string, details?: string) =>
  addLog('error', tag, message, details);
