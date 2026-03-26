import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  Conversation,
  Message,
  MessageSource,
  SearchDecision,
  WebValidationStatus,
} from '../types';
import {
  saveConversations,
  loadConversations,
  saveCurrentConversationId,
  loadCurrentConversationId,
} from '../services/storageService';
import {generateId, generateConversationTitle} from '../utils/helpers';
import {logError, logInfo} from '../services/logService';

const TAG = 'ChatStore';
const CONVERSATIONS_SAVE_DEBOUNCE_MS = 800;

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
  | {
      type: 'UPDATE_LAST_MESSAGE';
      conversationId: string;
      content: string;
      error?: boolean;
      sources?: MessageSource[];
      searchDecision?: SearchDecision;
      webValidationStatus?: WebValidationStatus;
      touchUpdatedAt?: boolean;
    }
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
      if (state.currentConversationId === action.id) {
        return state;
      }
      return {...state, currentConversationId: action.id};

    case 'ADD_MESSAGE': {
      let changed = false;
      const updated = state.conversations.map(conv => {
        if (conv.id !== action.conversationId) {
          return conv;
        }
        changed = true;
        const baseMessages = Array.isArray(conv.messages) ? conv.messages : [];
        return {
          ...conv,
          messages: [...baseMessages, action.message],
          updatedAt: Date.now(),
        };
      });
      if (!changed) {
        return state;
      }
      return {...state, conversations: updated};
    }

    case 'UPDATE_LAST_MESSAGE': {
      let changed = false;
      const updated = state.conversations.map(conv => {
        if (conv.id !== action.conversationId) {
          return conv;
        }
        const messages = Array.isArray(conv.messages) ? [...conv.messages] : [];
        if (messages.length === 0) {
          return conv;
        }
        const last = messages[messages.length - 1];
        const sameSources = areSourcesEqual(last.sources, action.sources);
        if (
          last.content === action.content &&
          last.error === action.error &&
          sameSources &&
          last.searchDecision === action.searchDecision &&
          last.webValidationStatus === action.webValidationStatus
        ) {
          return conv;
        }
        changed = true;
        messages[messages.length - 1] = {
          ...last,
          content: action.content,
          error: action.error,
          sources: action.sources,
          searchDecision: action.searchDecision,
          webValidationStatus: action.webValidationStatus,
        };
        return {
          ...conv,
          messages,
          updatedAt: action.touchUpdatedAt === false ? conv.updatedAt : Date.now(),
        };
      });
      if (!changed) {
        return state;
      }
      return {...state, conversations: updated};
    }

    case 'DELETE_CONVERSATION': {
      const remaining = state.conversations.filter(c => c.id !== action.id);
      if (remaining.length === state.conversations.length) {
        return state;
      }
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
      let changed = false;
      const updated = state.conversations.map(conv => {
        if (conv.id !== action.id || conv.title === action.title) {
          return conv;
        }
        changed = true;
        return {...conv, title: action.title};
      });
      if (!changed) {
        return state;
      }
      return {...state, conversations: updated};
    }

    default:
      return state;
  }
}

function areSourcesEqual(a: MessageSource[] | undefined, b: MessageSource[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index].title !== right[index].title ||
      left[index].url !== right[index].url ||
      left[index].siteName !== right[index].siteName
    ) {
      return false;
    }
  }
  return true;
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
  createConversation: () => string | null;
  setCurrentConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message;
  updateLastMessage: (
    conversationId: string,
    content: string,
    options?: {
      error?: boolean;
      sources?: MessageSource[];
      searchDecision?: SearchDecision;
      webValidationStatus?: WebValidationStatus;
      touchUpdatedAt?: boolean;
    },
  ) => void;
  deleteConversation: (id: string) => void;
  setLoading: (value: boolean) => void;
  getCurrentConversation: () => Conversation | undefined;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

function normalizeConversation(
  raw: Partial<Conversation> | null | undefined,
): Conversation | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const fallbackId = generateId();
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Nova Conversa';
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(msg => normalizeMessage(msg))
        .filter((msg): msg is Message => msg !== null)
    : [];
  const now = Date.now();
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
    ? raw.createdAt
    : now;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
    ? raw.updatedAt
    : createdAt;

  return {id, title, messages, createdAt, updatedAt};
}

function normalizeMessage(raw: Partial<Message> | null | undefined): Message | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateId();
  if (raw.role === 'system') {
    return null;
  }
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : 'assistant';
  const content = typeof raw.content === 'string' ? raw.content : '';
  const timestamp = typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
    ? raw.timestamp
    : Date.now();
  const error = raw.error === true ? true : undefined;
  const validSources = Array.isArray(raw.sources)
    ? raw.sources
        .map(source => {
          if (!source || typeof source !== 'object') {
            return null;
          }
          const title = typeof source.title === 'string' ? source.title.trim() : '';
          const url = typeof source.url === 'string' ? source.url.trim() : '';
          const siteName = typeof source.siteName === 'string' ? source.siteName.trim() : '';
          if (!title || !url || !siteName) {
            return null;
          }
          return {title, url, siteName};
        })
        .filter((source): source is MessageSource => source !== null)
    : undefined;
  const searchDecision =
    raw.searchDecision === 'local_only' ||
    raw.searchDecision === 'local_plus_web' ||
    raw.searchDecision === 'local_with_uncertainty'
      ? raw.searchDecision
      : undefined;
  const webValidationStatus =
    raw.webValidationStatus === 'not_needed' ||
    raw.webValidationStatus === 'validated' ||
    raw.webValidationStatus === 'failed'
      ? raw.webValidationStatus
      : undefined;
  return {
    id,
    role,
    content,
    timestamp,
    error,
    sources: validSources,
    searchDecision,
    webValidationStatus,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({children}: ChatProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const conversationsPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestConversationsRef = useRef<Conversation[]>([]);
  const lastPersistedCurrentConversationIdRef = useRef<string | null>(null);
  const pendingPersistAfterStreamingRef = useRef<boolean>(false);

  // Load persisted data on mount
  useEffect(() => {
    async function init() {
      try {
        logInfo(TAG, 'Inicializacao do chat store iniciada');
        const [loadedConversations, loadedCurrentId] = await Promise.all([
          loadConversations(),
          loadCurrentConversationId(),
        ]);
        logInfo(TAG, 'Carga inicial de conversas concluida');

        const conversations = loadedConversations
          .map(conv => normalizeConversation(conv))
          .filter((conv): conv is Conversation => conv !== null);

        // Validate currentId exists in conversations
        const validCurrentId =
          loadedCurrentId && conversations.some(c => c.id === loadedCurrentId)
            ? loadedCurrentId
            : conversations.length > 0
            ? conversations[0].id
            : null;

        dispatch({type: 'INIT', conversations, currentId: validCurrentId});
        logInfo(
          TAG,
          'Inicializacao do chat store concluida',
          `conversas=${conversations.length} currentId=${validCurrentId ?? 'null'}`,
        );
      } catch (error) {
        logError(TAG, 'Falha na inicializacao do chat store', toErrorDetails(error));
        dispatch({type: 'INIT', conversations: [], currentId: null});
      }
    }
    void init();
  }, []);

  // Auto-save whenever conversations change
  useEffect(() => {
    latestConversationsRef.current = state.conversations;
    if (!state.isInitialized) {
      return;
    }
    if (state.isLoading) {
      pendingPersistAfterStreamingRef.current = true;
      return;
    }
    if (conversationsPersistTimeoutRef.current) {
      clearTimeout(conversationsPersistTimeoutRef.current);
    }
    const delayMs = pendingPersistAfterStreamingRef.current
      ? Math.max(280, Math.floor(CONVERSATIONS_SAVE_DEBOUNCE_MS / 2))
      : CONVERSATIONS_SAVE_DEBOUNCE_MS;
    conversationsPersistTimeoutRef.current = setTimeout(() => {
      conversationsPersistTimeoutRef.current = null;
      pendingPersistAfterStreamingRef.current = false;
      void (async () => {
        try {
          await saveConversations(latestConversationsRef.current);
          logInfo(
            TAG,
            'Persistencia de conversas concluida',
            `Total de conversas: ${latestConversationsRef.current.length}`,
          );
        } catch (error) {
          const details =
            error instanceof Error
              ? `${error.message}\n${error.stack ?? 'stack indisponivel'}`
              : String(error);
          logError(TAG, 'Persistencia de conversas falhou', details);
        }
      })();
    }, delayMs);
  }, [state.conversations, state.isInitialized, state.isLoading]);

  useEffect(() => {
    return () => {
      if (conversationsPersistTimeoutRef.current) {
        clearTimeout(conversationsPersistTimeoutRef.current);
        conversationsPersistTimeoutRef.current = null;
        void saveConversations(latestConversationsRef.current).catch(error => {
          logError(TAG, 'Persistencia final de conversas falhou', toErrorDetails(error));
        });
      }
    };
  }, []);

  // Auto-save current conversation ID
  useEffect(() => {
    if (!state.isInitialized || state.currentConversationId === null) {
      return;
    }
    if (lastPersistedCurrentConversationIdRef.current === state.currentConversationId) {
      return;
    }
    lastPersistedCurrentConversationIdRef.current = state.currentConversationId;
    void (async () => {
      try {
        logInfo(
          TAG,
          'Persistencia do currentConversationId iniciada',
          state.currentConversationId,
        );
        await saveCurrentConversationId(state.currentConversationId);
        logInfo(TAG, 'Persistencia do currentConversationId concluida');
      } catch (error) {
        logError(
          TAG,
          'Persistencia do currentConversationId falhou',
          toErrorDetails(error),
        );
      }
    })();
  }, [state.currentConversationId, state.isInitialized]);

  const createConversation = useCallback((): string | null => {
    try {
      logInfo(TAG, 'Criacao de nova conversa iniciada');

      logInfo(TAG, 'Geracao do id da conversa iniciada');
      const generatedId = generateId();
      logInfo(TAG, 'Geracao do id da conversa concluida', generatedId);

      logInfo(TAG, 'Criacao do objeto da conversa iniciada');
      const now = Date.now();
      const rawConversation: Conversation = {
        id: generatedId,
        title: 'Nova Conversa',
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      logInfo(TAG, 'Criacao do objeto da conversa concluida');

      logInfo(TAG, 'Validacao da nova conversa iniciada');
      const conversation = normalizeConversation(rawConversation);
      if (!conversation) {
        logError(TAG, 'Validacao da nova conversa falhou: objeto invalido');
        return null;
      }
      logInfo(
        TAG,
        'Validacao da nova conversa concluida',
        `id=${conversation.id} title=${conversation.title} messages=${conversation.messages.length} updatedAt=${conversation.updatedAt}`,
      );

      logInfo(TAG, 'Atualizacao do store iniciada');
      dispatch({type: 'CREATE_CONVERSATION', conversation});
      logInfo(TAG, 'Atualizacao do store concluida');
      logInfo(TAG, 'Selecao da conversa atual concluida', conversation.id);

      return conversation.id;
    } catch (error) {
      logError(TAG, 'Catch no fluxo de criacao de nova conversa', toErrorDetails(error));
      return null;
    }
  }, []);

  const setCurrentConversation = useCallback(
    (id: string | null) => {
      try {
        logInfo(TAG, 'Atualizacao de selectedConversation iniciada', id ?? 'null');
        if (id === null) {
          dispatch({type: 'SET_CURRENT_CONVERSATION', id: null});
          logInfo(TAG, 'Atualizacao de selectedConversation concluida', 'null');
          return;
        }

        const exists = state.conversations.some(conv => conv.id === id);
        if (!exists) {
          logError(
            TAG,
            'Atualizacao de selectedConversation ignorada: id inexistente',
            id,
          );
          return;
        }

        dispatch({type: 'SET_CURRENT_CONVERSATION', id});
        logInfo(TAG, 'Atualizacao de selectedConversation concluida', id);
      } catch (error) {
        logError(TAG, 'Catch ao atualizar selectedConversation', toErrorDetails(error));
      }
    },
    [state.conversations],
  );

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
    (
      conversationId: string,
      content: string,
      options?: {
        error?: boolean;
        sources?: MessageSource[];
        searchDecision?: SearchDecision;
        webValidationStatus?: WebValidationStatus;
        touchUpdatedAt?: boolean;
      },
    ) => {
      dispatch({
        type: 'UPDATE_LAST_MESSAGE',
        conversationId,
        content,
        error: options?.error,
        sources: options?.sources,
        searchDecision: options?.searchDecision,
        webValidationStatus: options?.webValidationStatus,
        touchUpdatedAt: options?.touchUpdatedAt,
      });
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
