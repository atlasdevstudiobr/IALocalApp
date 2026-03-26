import React, {useCallback, useMemo} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SectionList,
  StyleSheet,
  SectionListRenderItem,
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
import {logError, logInfo} from '../services/logService';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
const TAG = 'DrawerContent';

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

interface Section {
  title: string;
  data: Conversation[];
}

function getSectionTitle(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 86400000);

  if (date >= startOfToday) {
    return 'Hoje';
  }
  if (date >= startOfYesterday) {
    return 'Ontem';
  }
  if (date >= startOfWeek) {
    return 'Esta semana';
  }
  return 'Mais antigo';
}

const SECTION_ORDER = ['Hoje', 'Ontem', 'Esta semana', 'Mais antigo'];

export default function DrawerContent(
  _props: DrawerContentComponentProps,
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const {state, createConversation, setCurrentConversation, deleteConversation} =
    useChatStore();

  const sections: Section[] = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const conv of state.conversations) {
      const key = getSectionTitle(conv.updatedAt);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(conv);
    }
    return SECTION_ORDER
      .filter(key => groups[key]?.length > 0)
      .map(key => ({title: key, data: groups[key]}));
  }, [state.conversations]);

  const handleNewConversation = useCallback(() => {
    try {
      logInfo(TAG, 'Clique em Nova Conversa recebido');
      logInfo(TAG, 'Handler de Nova Conversa iniciado');
      const id = createConversation();
      if (!id) {
        logError(TAG, 'Falha ao criar conversa: id invalido');
        return;
      }
      logInfo(TAG, 'Criacao da conversa no store concluida', id);

      logInfo(TAG, 'Selecao da conversa atual iniciada', id);
      setCurrentConversation(id);
      logInfo(TAG, 'Selecao da conversa atual concluida', id);

      logInfo(TAG, 'Atualizacao da UI iniciada (navegacao para Chat)', id);
      navigation.navigate('Chat', {conversationId: id});
      logInfo(TAG, 'Atualizacao da UI concluida (navegacao para Chat)', id);
      logInfo(TAG, 'Fluxo de Nova Conversa concluido com sucesso', id);
    } catch (error) {
      logError(TAG, 'Catch no fluxo de Nova Conversa', toErrorDetails(error));
    } finally {
      logInfo(TAG, 'Fluxo de Nova Conversa finalizado');
    }
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

  const renderItem: SectionListRenderItem<Conversation, Section> = useCallback(
    ({item}) => {
      const isActive = item.id === state.currentConversationId;
      return (
        <TouchableOpacity
          style={[styles.conversationItem, isActive && styles.conversationItemActive]}
          onPress={() => handleSelectConversation(item)}
          activeOpacity={0.7}>
          {isActive && <View style={styles.activeIndicator} />}
          <View style={styles.conversationContent}>
            <Text style={[styles.conversationTitle, isActive && styles.conversationTitleActive]} numberOfLines={1}>
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

  const renderSectionHeader = useCallback(
    ({section}: {section: Section}) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
      </View>
    ),
    [],
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
        {state.conversations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              Nenhuma conversa ainda.{'\n'}Toque em "Nova Conversa" para comecar.
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={keyExtractor}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
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
    paddingTop: spacing.xs,
  },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: 2,
    overflow: 'hidden',
  },
  conversationItemActive: {
    backgroundColor: colors.surfaceElevated,
  },
  activeIndicator: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
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
  conversationTitleActive: {
    color: colors.text,
    fontWeight: '600',
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
