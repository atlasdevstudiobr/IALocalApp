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
        const baseMessages = Array.isArray(conv.messages) ? conv.messages : [];
        return {
          ...conv,
          messages: [...baseMessages, action.message],
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
        const messages = Array.isArray(conv.messages) ? [...conv.messages] : [];
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
  createConversation: () => string | null;
  setCurrentConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message;
  updateLastMessage: (conversationId: string, content: string, error?: boolean) => void;
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
  return {id, role, content, timestamp, error};
}

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

      void (async () => {
        try {
          logInfo(TAG, 'Persistencia no storage iniciada');
          const nextConversations = [conversation, ...state.conversations];
          await saveConversations(nextConversations);
          await saveCurrentConversationId(conversation.id);
          logInfo(TAG, 'Persistencia no storage concluida');
        } catch (error) {
          logError(
            TAG,
            'Persistencia no storage falhou; conversa mantida em memoria',
            toErrorDetails(error),
          );
        }
      })();

      return conversation.id;
    } catch (error) {
      logError(TAG, 'Catch no fluxo de criacao de nova conversa', toErrorDetails(error));
      return null;
    }
  }, [state.conversations]);

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
