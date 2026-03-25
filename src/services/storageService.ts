import AsyncStorage from '@react-native-async-storage/async-storage';
import {Conversation} from '../types';
import {logError, logInfo} from './logService';

const TAG = 'StorageService';
const CONVERSATIONS_KEY = '@alfaai_conversations';
const CURRENT_CONVERSATION_KEY = '@alfaai_current_conversation_id';

/**
 * Saves all conversations to AsyncStorage.
 */
export async function saveConversations(
  conversations: Conversation[],
): Promise<void> {
  try {
    const serialized = JSON.stringify(conversations);
    await AsyncStorage.setItem(CONVERSATIONS_KEY, serialized);
    logInfo(TAG, `Saved ${conversations.length} conversation(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to save conversations', message);
  }
}

/**
 * Loads all conversations from AsyncStorage.
 * Returns an empty array if none found or on error.
 */
export async function loadConversations(): Promise<Conversation[]> {
  try {
    const raw = await AsyncStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: Conversation[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    logInfo(TAG, `Loaded ${parsed.length} conversation(s)`);
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
    await AsyncStorage.setItem(CURRENT_CONVERSATION_KEY, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to save current conversation ID', message);
  }
}

/**
 * Loads the current active conversation ID.
 * Returns null if not set or on error.
 */
export async function loadCurrentConversationId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(CURRENT_CONVERSATION_KEY);
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
    ]);
    logInfo(TAG, 'All data cleared');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(TAG, 'Failed to clear all data', message);
  }
}
