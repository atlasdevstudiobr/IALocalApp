import AsyncStorage from '@react-native-async-storage/async-storage';
import {Conversation} from '../types';
import {logError, logInfo} from './logService';
import {LOCAL_SAFETY_DISABLED_STORAGE_KEY} from './safetySettingsService';

const TAG = 'StorageService';
const CONVERSATIONS_KEY = '@alfaai_conversations';
const CURRENT_CONVERSATION_KEY = '@alfaai_current_conversation_id';
let lastSerializedConversationsSnapshot = '';
let lastSavedConversationId: string | null = null;

/**
 * Saves all conversations to AsyncStorage.
 */
export async function saveConversations(
  conversations: Conversation[],
): Promise<void> {
  try {
    const serialized = JSON.stringify(conversations);
    if (serialized === lastSerializedConversationsSnapshot) {
      return;
    }
    logInfo(TAG, 'Persistencia de conversas no AsyncStorage iniciada');
    await AsyncStorage.setItem(CONVERSATIONS_KEY, serialized);
    lastSerializedConversationsSnapshot = serialized;
    logInfo(TAG, `Persistencia de conversas no AsyncStorage concluida (${conversations.length})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to save conversations', message);
    throw error;
  }
}

/**
 * Loads all conversations from AsyncStorage.
 * Returns an empty array if none found or on error.
 */
export async function loadConversations(): Promise<Conversation[]> {
  try {
    logInfo(TAG, 'Restore de conversas no AsyncStorage iniciado');
    const raw = await AsyncStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) {
      logInfo(TAG, 'Restore de conversas concluido (sem dados)');
      return [];
    }
    const parsed: Conversation[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logError(TAG, 'Restore de conversas encontrou payload invalido (nao array)');
      return [];
    }
    lastSerializedConversationsSnapshot = raw;
    logInfo(TAG, `Restore de conversas concluido (${parsed.length})`);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to load conversations', message);
    return [];
  }
}

/**
 * Saves the current active conversation ID.
 */
export async function saveCurrentConversationId(id: string): Promise<void> {
  try {
    if (lastSavedConversationId === id) {
      return;
    }
    logInfo(TAG, 'Persistencia do currentConversationId iniciada', id);
    await AsyncStorage.setItem(CURRENT_CONVERSATION_KEY, id);
    lastSavedConversationId = id;
    logInfo(TAG, 'Persistencia do currentConversationId concluida', id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to save current conversation ID', message);
    throw error;
  }
}

/**
 * Loads the current active conversation ID.
 * Returns null if not set or on error.
 */
export async function loadCurrentConversationId(): Promise<string | null> {
  try {
    logInfo(TAG, 'Restore do currentConversationId iniciado');
    const id = await AsyncStorage.getItem(CURRENT_CONVERSATION_KEY);
    lastSavedConversationId = id;
    logInfo(TAG, 'Restore do currentConversationId concluido', id ?? 'null');
    return id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to load current conversation ID', message);
    return null;
  }
}

/**
 * Clears all app data from AsyncStorage. Use with caution.
 */
export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      CONVERSATIONS_KEY,
      CURRENT_CONVERSATION_KEY,
      LOCAL_SAFETY_DISABLED_STORAGE_KEY,
    ]);
    lastSerializedConversationsSnapshot = '';
    lastSavedConversationId = null;
    logInfo(TAG, 'All data cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to clear all data', message);
  }
}
