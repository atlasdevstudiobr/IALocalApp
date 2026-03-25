import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ListRenderItem,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions, useRoute, RouteProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Message} from '../types';
import {useChatStore} from '../store/chatStore';
import {generateResponse} from '../services/aiService';
import {logError, logInfo} from '../services/logService';
import ChatBubble from '../components/ChatBubble';
import ChatInput from '../components/ChatInput';
import {colors, spacing, fonts, radius} from '../theme';
import {RootStackParamList} from '../navigation/AppNavigator';
import {truncateText} from '../utils/helpers';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const TAG = 'ChatScreen';

export default function ChatScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const {state, addMessage, updateLastMessage, setLoading, setCurrentConversation} =
    useChatStore();

  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);

  // Resolve active conversation ID from route params or store
  const conversationId =
    route.params?.conversationId ?? state.currentConversationId ?? '';

  const conversation = state.conversations.find(c => c.id === conversationId);
  const messages = conversation?.messages ?? [];
  const isLoading = state.isLoading;

  // Sync current conversation when navigating directly to a chat
  useEffect(() => {
    if (conversationId && conversationId !== state.currentConversationId) {
      setCurrentConversation(conversationId);
    }
  }, [conversationId, state.currentConversationId, setCurrentConversation]);

  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading || !conversationId) {
      return;
    }

    setInputText('');
    setLoading(true);

    logInfo(TAG, 'Sending user message', truncateText(trimmed, 60));

    // Add user message
    addMessage(conversationId, {
      role: 'user',
      content: trimmed,
    });

    // Add placeholder assistant message
    const assistantMsg = addMessage(conversationId, {
      role: 'assistant',
      content: '',
    });

    try {
      const allMessages = [...messages, {
        id: 'temp-user',
        role: 'user' as const,
        content: trimmed,
        timestamp: Date.now(),
      }];

      const response = await generateResponse(allMessages);
      updateLastMessage(conversationId, response);
      logInfo(TAG, 'Received AI response');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido';
      updateLastMessage(
        conversationId,
        `Erro ao gerar resposta: ${errorMessage}`,
        true,
      );
      logError(TAG, 'Failed to generate AI response', errorMessage);
    } finally {
      setLoading(false);
      // Scroll to top of inverted list (newest message)
      flatListRef.current?.scrollToOffset({offset: 0, animated: true});
    }

    // Suppress unused var warning for assistantMsg
    void assistantMsg;
  }, [
    inputText,
    isLoading,
    conversationId,
    messages,
    addMessage,
    updateLastMessage,
    setLoading,
  ]);

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const renderMessage: ListRenderItem<Message> = useCallback(
    ({item}) => <ChatBubble message={item} />,
    [],
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const title = conversation?.title ?? 'Nova Conversa';

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
        <View style={styles.headerRight}>
          {isLoading && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.loadingIndicator}
            />
          )}
        </View>
      </View>

      {/* Messages + Input wrapped in KeyboardAvoidingView */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        keyboardVerticalOffset={0}>

        {/* Messages list */}
        {messages.length === 0 ? (
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
            data={[...messages].reverse()}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{minIndexForVisible: 0}}
          />
        )}

        {/* Input bar */}
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          isLoading={isLoading}
        />

        {/* Bottom safe area padding */}
        <View style={{height: insets.bottom}} />
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIndicator: {
    marginLeft: spacing.sm,
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
