import React, {useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ListRenderItem,
} from 'react-native';
import {DrawerContentComponentProps} from '@react-navigation/drawer';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {useChatStore} from '../store/chatStore';
import {Conversation} from '../types';
import {colors, spacing, fonts, radius} from '../theme';
import {truncateText, formatDate} from '../utils/helpers';
import {RootStackParamList} from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function DrawerContent(
  _props: DrawerContentComponentProps,
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const {state, createConversation, setCurrentConversation, deleteConversation} =
    useChatStore();

  const handleNewConversation = useCallback(() => {
    const id = createConversation();
    setCurrentConversation(id);
    navigation.navigate('Chat', {conversationId: id});
  }, [createConversation, setCurrentConversation, navigation]);

  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      setCurrentConversation(conversation.id);
      navigation.navigate('Chat', {conversationId: conversation.id});
    },
    [setCurrentConversation, navigation],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversation(id);
    },
    [deleteConversation],
  );

  const handleSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const renderItem: ListRenderItem<Conversation> = useCallback(
    ({item}) => {
      const isActive = item.id === state.currentConversationId;
      return (
        <TouchableOpacity
          style={[styles.conversationItem, isActive && styles.conversationItemActive]}
          onPress={() => handleSelectConversation(item)}
          activeOpacity={0.7}>
          <View style={styles.conversationContent}>
            <Text style={styles.conversationTitle} numberOfLines={1}>
              {truncateText(item.title, 35)}
            </Text>
            <Text style={styles.conversationDate}>
              {formatDate(item.updatedAt)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteConversation(item.id)}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.deleteIcon}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [state.currentConversationId, handleSelectConversation, handleDeleteConversation],
  );

  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>A</Text>
          </View>
          <Text style={styles.appName}>Alfa AI</Text>
        </View>
        <TouchableOpacity
          style={styles.newChatButton}
          onPress={handleNewConversation}
          activeOpacity={0.8}>
          <Text style={styles.newChatIcon}>+</Text>
          <Text style={styles.newChatText}>Nova Conversa</Text>
        </TouchableOpacity>
      </View>

      {/* Conversations List */}
      <View style={styles.listContainer}>
        <Text style={styles.sectionLabel}>CONVERSAS</Text>
        {state.conversations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              Nenhuma conversa ainda.{'\n'}Toque em "Nova Conversa" para comecar.
            </Text>
          </View>
        ) : (
          <FlatList
            data={state.conversations}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      {/* Footer */}
      <View style={[styles.footer, {paddingBottom: insets.bottom + spacing.md}]}>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={handleSettings}
          activeOpacity={0.7}>
          <Text style={styles.settingsIcon}>⚙</Text>
          <Text style={styles.settingsText}>Configuracoes</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.lg,
    fontWeight: '700',
  },
  appName: {
    color: colors.text,
    fontSize: fonts.sizes.xl,
    fontWeight: '700',
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  newChatIcon: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.xl,
    fontWeight: '300',
    marginRight: spacing.xs,
    lineHeight: 22,
  },
  newChatText: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.base,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
    paddingTop: spacing.md,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    fontWeight: '600',
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.sm,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: 2,
  },
  conversationItemActive: {
    backgroundColor: colors.surfaceElevated,
  },
  conversationContent: {
    flex: 1,
  },
  conversationTitle: {
    color: colors.text,
    fontSize: fonts.sizes.sm,
    fontWeight: '500',
    marginBottom: 2,
  },
  conversationDate: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
  },
  deleteButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  deleteIcon: {
    color: colors.textMuted,
    fontSize: fonts.sizes.sm,
  },
  emptyState: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  emptyStateText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  settingsIcon: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.lg,
    marginRight: spacing.sm,
  },
  settingsText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
  },
});
