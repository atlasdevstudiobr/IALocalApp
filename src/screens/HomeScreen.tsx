import React, {useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {useChatStore} from '../store/chatStore';
import {colors, spacing, fonts, radius} from '../theme';
import {RootStackParamList} from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const {createConversation, setCurrentConversation} = useChatStore();

  const handleStartChat = useCallback(() => {
    const id = createConversation();
    setCurrentConversation(id);
    navigation.navigate('Chat', {conversationId: id});
  }, [createConversation, setCurrentConversation, navigation]);

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

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
      </View>

      {/* Main content */}
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>A</Text>
          </View>
        </View>

        <Text style={styles.title}>Alfa AI</Text>
        <Text style={styles.subtitle}>
          Seu assistente de IA local,{'\n'}privado e sem internet.
        </Text>

        {/* Feature pills */}
        <View style={styles.features}>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>&#128274;</Text>
            <Text style={styles.featureText}>100% Privado</Text>
          </View>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>&#9889;</Text>
            <Text style={styles.featureText}>Offline</Text>
          </View>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>&#129504;</Text>
            <Text style={styles.featureText}>IA Local</Text>
          </View>
        </View>

        {/* CTA Button */}
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartChat}
          activeOpacity={0.85}>
          <Text style={styles.startButtonText}>Iniciar Conversa</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          O modelo precisa estar instalado para usar a IA.{'\n'}
          Acesse Configuracoes para instalar.
        </Text>
      </View>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuButton: {
    padding: spacing.sm,
  },
  menuIcon: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xl,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  logoContainer: {
    marginBottom: spacing.lg,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  logoLetter: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: fonts.sizes.xxl,
    fontWeight: '700',
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIcon: {
    fontSize: fonts.sizes.sm,
    marginRight: spacing.xs,
  },
  featureText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
    fontWeight: '500',
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    minWidth: 200,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.lg,
    fontWeight: '700',
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
});
