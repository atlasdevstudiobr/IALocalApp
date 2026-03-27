import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
import {
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  ListRenderItem,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions, useRoute, RouteProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Message} from '../types';
import {useChatStore} from '../store/chatStore';
import {generateResponsePackageStream} from '../services/aiService';
import {logError} from '../services/logService';
import ChatBubble from '../components/ChatBubble';
import ChatInput from '../components/ChatInput';
import {useKeyboardHeight} from '../hooks/useKeyboardHeight';
import {colors, spacing, fonts, radius} from '../theme';
import {RootStackParamList} from '../navigation/AppNavigator';
import {truncateText} from '../utils/helpers';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const TAG = 'ChatScreen';
const SEND_FALLBACK_MESSAGE =
  'Não consegui responder agora. Verifique a conexão e tente novamente.';
const STREAM_FLUSH_FRAME_MS = 80;
const MAX_MESSAGES_FOR_CONTEXT = 12;

function mergeStreamPiece(current: string, incoming: string): string {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (incoming === current) {
    return current;
  }
  if (incoming.startsWith(current)) {
    return incoming;
  }
  if (current.startsWith(incoming)) {
    return current;
  }

  const overlapLimit = Math.min(current.length, incoming.length);
  for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
    if (current.endsWith(incoming.slice(0, overlap))) {
      return `${current}${incoming.slice(overlap)}`;
    }
  }

  return `${current}${incoming}`;
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

export default function ChatScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const {state, addMessage, updateLastMessage, setLoading, setCurrentConversation} =
    useChatStore();

  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);
  const scrollToLatest = useCallback((animated: boolean) => {
    const runScroll = () => {
      flatListRef.current?.scrollToOffset({offset: 0, animated});
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(runScroll);
      return;
    }
    setTimeout(runScroll, 0);
  }, []);

  // Resolve active conversation ID safely from route params/store/list
  const conversationId = useMemo(() => {
    const routeId = route.params?.conversationId;
    if (routeId) {
      return routeId;
    }
    if (state.currentConversationId) {
      return state.currentConversationId;
    }
    return state.conversations[0]?.id ?? '';
  }, [route.params?.conversationId, state.currentConversationId, state.conversations]);

  const conversation = state.conversations.find(c => c.id === conversationId) ?? null;
  const messages = Array.isArray(conversation?.messages) ? (conversation?.messages ?? []) : [];
  const visibleMessages = useMemo(
    () => messages.filter(message => message?.role === 'user' || message?.role === 'assistant'),
    [messages],
  );
  const reversedVisibleMessages = useMemo(
    () => [...visibleMessages].reverse(),
    [visibleMessages],
  );
  const messagesForInference = useMemo(() => {
    if (visibleMessages.length <= MAX_MESSAGES_FOR_CONTEXT) {
      return visibleMessages;
    }
    return visibleMessages.slice(-MAX_MESSAGES_FOR_CONTEXT);
  }, [visibleMessages]);
  const isLoading = state.isLoading;
  // Em Android, inverted + maintainVisibleContentPosition pode causar crash nativo da lista.
  const maintainVisibleContentPosition =
    Platform.OS === 'ios' ? {minIndexForVisible: 0} : undefined;

  // Sync current conversation when navigating directly to a chat
  useEffect(() => {
    if (conversationId && conversationId !== state.currentConversationId) {
      setCurrentConversation(conversationId);
    }
  }, [conversationId, state.currentConversationId, setCurrentConversation]);

  const handleSend = useCallback(async () => {
    let targetConversationId = conversationId;
    let assistantPlaceholderCreated = false;
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let streamTargetText = '';
    let streamRenderedText = '';

    const stopStreamFlush = () => {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
    };

    const flushStreamNow = (touchUpdatedAt: boolean) => {
      if (!targetConversationId || !assistantPlaceholderCreated || !streamTargetText) {
        return streamRenderedText;
      }
      if (!touchUpdatedAt && streamRenderedText === streamTargetText) {
        return streamRenderedText;
      }
      streamRenderedText = streamTargetText;
      updateLastMessage(targetConversationId, streamRenderedText, {
        isStreaming: true,
        touchUpdatedAt,
      });
      if (!touchUpdatedAt) {
        scrollToLatest(false);
      }
      return streamRenderedText;
    };

    const scheduleStreamFlush = () => {
      if (streamFlushTimer) {
        return;
      }
      streamFlushTimer = setTimeout(() => {
        streamFlushTimer = null;
        flushStreamNow(false);
        if (streamTargetText !== streamRenderedText) {
          scheduleStreamFlush();
        }
      }, STREAM_FLUSH_FRAME_MS);
    };

    const registerPartial = (partialText: string) => {
      if (!partialText) {
        return;
      }

      if (!streamTargetText) {
        streamTargetText = partialText;
        scheduleStreamFlush();
        return;
      }

      if (partialText.startsWith(streamTargetText)) {
        streamTargetText = partialText;
        scheduleStreamFlush();
        return;
      }

      if (streamTargetText.startsWith(partialText)) {
        return;
      }

      streamTargetText = mergeStreamPiece(streamTargetText, partialText);
      scheduleStreamFlush();
    };

    const hasPartialContent = (): boolean => {
      return Boolean(streamTargetText.trim() || streamRenderedText.trim());
    };

    const getBestPartial = (): string => {
      if (streamTargetText.trim()) {
        return streamTargetText;
      }
      return streamRenderedText;
    };

    try {
      const trimmed = inputText.trim();
      if (!trimmed || isLoading || !targetConversationId) {
        return;
      }

      setInputText('');
      setLoading(true);

      addMessage(targetConversationId, {
        role: 'user',
        content: trimmed,
      });

      addMessage(targetConversationId, {
        role: 'assistant',
        content: '',
        isStreaming: true,
      });
      assistantPlaceholderCreated = true;

      const allMessages = [
        ...messagesForInference,
        {
          id: 'temp-user',
          role: 'user' as const,
          content: trimmed,
          timestamp: Date.now(),
        },
      ];

      const responsePackage = await generateResponsePackageStream(
        allMessages,
        (partialText: string) => {
          if (!partialText) {
            return;
          }
          registerPartial(partialText);
        },
      );
      stopStreamFlush();
      flushStreamNow(false);

      const finalText = responsePackage.text || getBestPartial();
      if (!finalText) {
        logError(TAG, 'generateResponsePackageStream retornou texto vazio no ChatScreen');
        if (hasPartialContent()) {
          updateLastMessage(targetConversationId, getBestPartial(), {
            isStreaming: false,
            touchUpdatedAt: true,
          });
        } else {
          updateLastMessage(targetConversationId, SEND_FALLBACK_MESSAGE, {
            isStreaming: false,
            error: true,
            touchUpdatedAt: true,
          });
        }
        scrollToLatest(true);
        return;
      }

      updateLastMessage(targetConversationId, finalText, {
        isStreaming: false,
        sources: responsePackage.sources,
        searchDecision: responsePackage.searchDecision,
        webValidationStatus: responsePackage.webValidationStatus,
        touchUpdatedAt: true,
      });
      scrollToLatest(true);
    } catch (error) {
      logError(TAG, 'Catch no fluxo de envio do chat', toErrorDetails(error));
      stopStreamFlush();
      flushStreamNow(false);
      if (targetConversationId) {
        if (assistantPlaceholderCreated) {
          if (hasPartialContent()) {
            updateLastMessage(targetConversationId, getBestPartial(), {
              isStreaming: false,
              touchUpdatedAt: true,
            });
          } else {
            updateLastMessage(targetConversationId, SEND_FALLBACK_MESSAGE, {
              isStreaming: false,
              error: true,
              touchUpdatedAt: true,
            });
          }
          scrollToLatest(true);
        } else {
          addMessage(targetConversationId, {
            role: 'assistant',
            content: SEND_FALLBACK_MESSAGE,
            error: true,
          });
          scrollToLatest(true);
        }
      }
    } finally {
      setLoading(false);
      scrollToLatest(true);
    }
  }, [
    inputText,
    isLoading,
    conversationId,
    messagesForInference,
    addMessage,
    updateLastMessage,
    setLoading,
    scrollToLatest,
  ]);

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const renderMessage: ListRenderItem<Message> = useCallback(
    ({item}) => {
      if (!item || typeof item !== 'object') {
        logError(TAG, 'Mensagem invalida detectada no renderItem do chat');
        return null;
      }
      return <ChatBubble message={item} />;
    },
    [],
  );

  const keyExtractor = useCallback(
    (item: Message, index: number) =>
      typeof item?.id === 'string' && item.id ? item.id : `message-${index}`,
    [],
  );

  const title = conversation?.title ?? 'Nova Conversa';

  // On Android, adjustResize in AndroidManifest handles the keyboard resize.
  // We only need to compensate the bottom safe area inset when keyboard is hidden.
  const bottomSpacerHeight = Platform.OS === 'android'
    ? (keyboardHeight > 0 ? 0 : insets.bottom)
    : insets.bottom;

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleOpenDrawer}
          activeOpacity={0.7}>
          <Text style={styles.menuIcon}>&#9776;</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {truncateText(title, 30)}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {/* Messages + Input */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>

        {visibleMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <View style={styles.emptyChatIcon}>
              <Text style={styles.emptyChatIconText}>A</Text>
            </View>
            <Text style={styles.emptyChatTitle}>Como posso ajudar?</Text>
            <Text style={styles.emptyChatSubtitle}>
              Digite sua mensagem abaixo para comecar.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={reversedVisibleMessages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={maintainVisibleContentPosition}
            removeClippedSubviews={Platform.OS === 'android'}
            windowSize={8}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={40}
          />
        )}

        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          isLoading={isLoading}
        />

        <View style={{height: bottomSpacerHeight}} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  menuButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  menuIcon: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xl,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fonts.sizes.base,
    fontWeight: '600',
  },
  headerRight: {
    width: 36,
  },
  keyboardAvoid: {
    flex: 1,
  },
  messageList: {
    paddingVertical: spacing.md,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyChatIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyChatIconText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
  },
  emptyChatTitle: {
    color: colors.text,
    fontSize: fonts.sizes.xl,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  emptyChatSubtitle: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
    textAlign: 'center',
    lineHeight: 22,
  },
});
