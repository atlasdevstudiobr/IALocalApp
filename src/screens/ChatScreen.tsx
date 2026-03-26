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
import {generateResponseStream, warmupRuntimeSafely} from '../services/aiService';
import {logError, logInfo} from '../services/logService';
import ChatBubble from '../components/ChatBubble';
import ChatInput from '../components/ChatInput';
import {useKeyboardHeight} from '../hooks/useKeyboardHeight';
import {colors, spacing, fonts, radius} from '../theme';
import {RootStackParamList} from '../navigation/AppNavigator';
import {truncateText} from '../utils/helpers';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const TAG = 'ChatScreen';
const SEND_FALLBACK_MESSAGE = 'Falha ao carregar o runtime local. Veja os logs.';
const STREAM_UPDATE_INTERVAL_MS = 70;
const MAX_RUNTIME_MESSAGES = 16;

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
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const visibleMessages = useMemo(
    () => messages.filter(message => message?.role === 'user' || message?.role === 'assistant'),
    [messages],
  );
  const reversedVisibleMessages = useMemo(
    () => [...visibleMessages].reverse(),
    [visibleMessages],
  );
  const runtimeMessagesForInference = useMemo(() => {
    if (visibleMessages.length <= MAX_RUNTIME_MESSAGES) {
      return visibleMessages;
    }
    return visibleMessages.slice(-MAX_RUNTIME_MESSAGES);
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

  useEffect(() => {
    void (async () => {
      try {
        logInfo(TAG, 'Warmup do runtime disparado fora do clique em enviar');
        await warmupRuntimeSafely();
        logInfo(TAG, 'Warmup do runtime finalizado no mount do ChatScreen');
      } catch (error) {
        logError(TAG, 'Erro no warmup do ChatScreen', toErrorDetails(error));
      }
    })();
  }, []);

  const handleSend = useCallback(async () => {
    let targetConversationId = conversationId;
    let assistantPlaceholderCreated = false;
    let streamTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingStreamText = '';
    let lastStreamPushAt = 0;

    const flushStreamUpdate = () => {
      if (!targetConversationId || !assistantPlaceholderCreated || !pendingStreamText) {
        streamTimer = null;
        return;
      }
      updateLastMessage(targetConversationId, pendingStreamText);
      lastStreamPushAt = Date.now();
      streamTimer = null;
    };

    const scheduleStreamUpdate = (partialText: string) => {
      pendingStreamText = partialText;
      const now = Date.now();
      const elapsed = now - lastStreamPushAt;
      if (elapsed >= STREAM_UPDATE_INTERVAL_MS) {
        if (streamTimer) {
          clearTimeout(streamTimer);
          streamTimer = null;
        }
        flushStreamUpdate();
        return;
      }
      if (streamTimer) {
        return;
      }
      streamTimer = setTimeout(flushStreamUpdate, STREAM_UPDATE_INTERVAL_MS - elapsed);
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
      });
      assistantPlaceholderCreated = true;

      const allMessages = [...runtimeMessagesForInference, {
        id: 'temp-user',
        role: 'user' as const,
        content: trimmed,
        timestamp: Date.now(),
      }];

      const response = await generateResponseStream(allMessages, (partialText: string) => {
        if (!partialText) {
          return;
        }
        scheduleStreamUpdate(partialText);
      });
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
      flushStreamUpdate();

      if (!response) {
        logError(TAG, 'generateResponseStream retornou null/undefined/vazio no ChatScreen');
        updateLastMessage(targetConversationId, SEND_FALLBACK_MESSAGE, true);
        return;
      }

      updateLastMessage(targetConversationId, response);
    } catch (error) {
      logError(TAG, 'Catch no fluxo de envio do chat', toErrorDetails(error));
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
      if (targetConversationId) {
        if (assistantPlaceholderCreated) {
          updateLastMessage(targetConversationId, SEND_FALLBACK_MESSAGE, true);
        } else {
          addMessage(targetConversationId, {
            role: 'assistant',
            content: SEND_FALLBACK_MESSAGE,
            error: true,
          });
        }
      }
    } finally {
      setLoading(false);
      flatListRef.current?.scrollToOffset({offset: 0, animated: true});
    }
  }, [
    inputText,
    isLoading,
    conversationId,
    runtimeMessagesForInference,
    addMessage,
    updateLastMessage,
    setLoading,
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
