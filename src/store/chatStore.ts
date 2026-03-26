import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {Conversation, Message} from '../types';
import {
  saveConversations,
  loadConversations,
  saveCurrentConversationId,
  loadCurrentConversationId,
} from '../services/storageService';
import {generateId, generateConversationTitle} from '../utils/helpers';
import {logError, logInfo} from '../services/logService';

const TAG = 'ChatStore';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  isInitialized: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ChatAction =
  | {type: 'INIT'; conversations: Conversation[]; currentId: string | null}
  | {type: 'SET_LOADING'; value: boolean}
  | {type: 'CREATE_CONVERSATION'; conversation: Conversation}
  | {type: 'SET_CURRENT_CONVERSATION'; id: string | null}
  | {type: 'ADD_MESSAGE'; conversationId: string; message: Message}
  | {type: 'UPDATE_LAST_MESSAGE'; conversationId: string; content: string; error?: boolean}
  | {type: 'DELETE_CONVERSATION'; id: string}
  | {type: 'UPDATE_CONVERSATION_TITLE'; id: string; title: string};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        conversations: action.conversations,
        currentConversationId: action.currentId,
        isInitialized: true,
      };

    case 'SET_LOADING':
      return {...state, isLoading: action.value};

    case 'CREATE_CONVERSATION':
      return {
        ...state,
        conversations: [action.conversation, ...state.conversations],
        currentConversationId: action.conversation.id,
      };

    case 'SET_CURRENT_CONVERSATION':
      return {...state, currentConversationId: action.id};

    case 'ADD_MESSAGE': {
      const updated = state.conversations.map(conv => {
        if (conv.id !== action.conversationId) {
          return conv;
        }
        return {
          ...conv,
          messages: [...conv.messages, action.message],
          updatedAt: Date.now(),
        };
      });
      return {...state, conversations: updated};
    }

    case 'UPDATE_LAST_MESSAGE': {
      const updated = state.conversations.map(conv => {
        if (conv.id !== action.conversationId) {
          return conv;
        }
        const messages = [...conv.messages];
        if (messages.length === 0) {
          return conv;
        }
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = {
          ...last,
          content: action.content,
          error: action.error,
        };
        return {...conv, messages, updatedAt: Date.now()};
      });
      return {...state, conversations: updated};
    }

    case 'DELETE_CONVERSATION': {
      const remaining = state.conversations.filter(c => c.id !== action.id);
      const newCurrentId =
        state.currentConversationId === action.id
          ? remaining.length > 0
            ? remaining[0].id
            : null
          : state.currentConversationId;
      return {
        ...state,
        conversations: remaining,
        currentConversationId: newCurrentId,
      };
    }

    case 'UPDATE_CONVERSATION_TITLE': {
      const updated = state.conversations.map(conv =>
        conv.id === action.id ? {...conv, title: action.title} : conv,
      );
      return {...state, conversations: updated};
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: ChatState = {
  conversations: [],
  currentConversationId: null,
  isLoading: false,
  isInitialized: false,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatContextValue {
  state: ChatState;
  createConversation: () => string;
  setCurrentConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message;
  updateLastMessage: (conversationId: string, content: string, error?: boolean) => void;
  deleteConversation: (id: string) => void;
  setLoading: (value: boolean) => void;
  getCurrentConversation: () => Conversation | undefined;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({children}: ChatProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Load persisted data on mount
  useEffect(() => {
    async function init() {
      logInfo(TAG, 'Initializing chat store');
      const [conversations, currentId] = await Promise.all([
        loadConversations(),
        loadCurrentConversationId(),
      ]);

      // Validate currentId exists in conversations
      const validCurrentId =
        currentId && conversations.some(c => c.id === currentId)
          ? currentId
          : conversations.length > 0
          ? conversations[0].id
          : null;

      dispatch({type: 'INIT', conversations, currentId: validCurrentId});
      logInfo(TAG, `Loaded ${conversations.length} conversations`);
    }
    init();
  }, []);

  // Auto-save whenever conversations change
  useEffect(() => {
    if (!state.isInitialized) {
      return;
    }
    logInfo(
      TAG,
      'Persistencia de conversas iniciada',
      `Total de conversas: ${state.conversations.length}`,
    );
    void (async () => {
      try {
        await saveConversations(state.conversations);
        logInfo(TAG, 'Persistencia de conversas concluida');
      } catch (error) {
        const details =
          error instanceof Error
            ? `${error.message}\n${error.stack ?? 'stack indisponivel'}`
            : String(error);
        logError(TAG, 'Persistencia de conversas falhou', details);
      }
    })();
  }, [state.conversations, state.isInitialized]);

  // Auto-save current conversation ID
  useEffect(() => {
    if (!state.isInitialized || state.currentConversationId === null) {
      return;
    }
    saveCurrentConversationId(state.currentConversationId);
  }, [state.currentConversationId, state.isInitialized]);

  const createConversation = useCallback((): string => {
    const id = generateId();
    const now = Date.now();
    const conversation: Conversation = {
      id,
      title: 'Nova Conversa',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    dispatch({type: 'CREATE_CONVERSATION', conversation});
    logInfo(TAG, `Created conversation: ${id}`);
    return id;
  }, []);

  const setCurrentConversation = useCallback((id: string | null) => {
    dispatch({type: 'SET_CURRENT_CONVERSATION', id});
  }, []);

  const addMessage = useCallback(
    (
      conversationId: string,
      messageData: Omit<Message, 'id' | 'timestamp'>,
    ): Message => {
      const message: Message = {
        ...messageData,
        id: generateId(),
        timestamp: Date.now(),
      };
      dispatch({type: 'ADD_MESSAGE', conversationId, message});

      // Auto-generate title from first user message
      if (messageData.role === 'user') {
        // Will check after state update — defer with timeout
        setTimeout(() => {
          dispatch({
            type: 'UPDATE_CONVERSATION_TITLE',
            id: conversationId,
            title: generateConversationTitle(messageData.content),
          });
        }, 0);
      }

      return message;
    },
    [],
  );

  const updateLastMessage = useCallback(
    (conversationId: string, content: string, error?: boolean) => {
      dispatch({type: 'UPDATE_LAST_MESSAGE', conversationId, content, error});
    },
    [],
  );

  const deleteConversation = useCallback((id: string) => {
    dispatch({type: 'DELETE_CONVERSATION', id});
    logInfo(TAG, `Deleted conversation: ${id}`);
  }, []);

  const setLoading = useCallback((value: boolean) => {
    dispatch({type: 'SET_LOADING', value});
  }, []);

  const getCurrentConversation = useCallback((): Conversation | undefined => {
    if (!state.currentConversationId) {
      return undefined;
    }
    return state.conversations.find(c => c.id === state.currentConversationId);
  }, [state.conversations, state.currentConversationId]);

  const value: ChatContextValue = {
    state,
    createConversation,
    setCurrentConversation,
    addMessage,
    updateLastMessage,
    deleteConversation,
    setLoading,
    getCurrentConversation,
  };

  return React.createElement(ChatContext.Provider, {value}, children);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatStore(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatStore must be used within a ChatProvider');
  }
  return context;
}
