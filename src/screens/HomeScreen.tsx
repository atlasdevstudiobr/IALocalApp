import React, {useCallback, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {useChatStore} from '../store/chatStore';
import {colors, spacing, fonts, radius} from '../theme';
import {RootStackParamList} from '../navigation/AppNavigator';
import {logError, logInfo} from '../services/logService';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
const TAG = 'HomeScreen';

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

export default function HomeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const {createConversation, setCurrentConversation} = useChatStore();

  const logoAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;
  const pill1Anim = useRef(new Animated.Value(0)).current;
  const pill2Anim = useRef(new Animated.Value(0)).current;
  const pill3Anim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(90, [
      Animated.timing(logoAnim, {toValue: 1, duration: 500, useNativeDriver: true}),
      Animated.timing(titleAnim, {toValue: 1, duration: 400, useNativeDriver: true}),
      Animated.timing(subtitleAnim, {toValue: 1, duration: 400, useNativeDriver: true}),
      Animated.timing(pill1Anim, {toValue: 1, duration: 300, useNativeDriver: true}),
      Animated.timing(pill2Anim, {toValue: 1, duration: 300, useNativeDriver: true}),
      Animated.timing(pill3Anim, {toValue: 1, duration: 300, useNativeDriver: true}),
      Animated.timing(buttonAnim, {toValue: 1, duration: 400, useNativeDriver: true}),
    ]).start();
  }, [logoAnim, titleAnim, subtitleAnim, pill1Anim, pill2Anim, pill3Anim, buttonAnim]);

  const fadeSlide = (anim: Animated.Value, offsetY = 16) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [offsetY, 0],
        }),
      },
    ],
  });

  const handleStartChat = useCallback(() => {
    try {
      logInfo(TAG, 'Clique em Iniciar Conversa recebido');
      const id = createConversation();
      if (!id) {
        logError(TAG, 'Falha ao iniciar conversa: id invalido');
        return;
      }
      logInfo(TAG, 'Criacao da conversa no store concluida', id);

      logInfo(TAG, 'Selecao da conversa atual iniciada', id);
      setCurrentConversation(id);
      logInfo(TAG, 'Selecao da conversa atual concluida', id);

      logInfo(TAG, 'Atualizacao da UI iniciada (navegacao para Chat)', id);
      navigation.navigate('Chat', {conversationId: id});
      logInfo(TAG, 'Atualizacao da UI concluida (navegacao para Chat)', id);
    } catch (error) {
      logError(TAG, 'Catch no fluxo de Iniciar Conversa', toErrorDetails(error));
    } finally {
      logInfo(TAG, 'Fluxo de Iniciar Conversa finalizado');
    }
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
        <Animated.View style={[styles.logoContainer, fadeSlide(logoAnim, 24)]}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>A</Text>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.title, fadeSlide(titleAnim)]}>
          Alfa AI
        </Animated.Text>

        <Animated.Text style={[styles.subtitle, fadeSlide(subtitleAnim)]}>
          Seu assistente de IA local,{'\n'}privado e sem internet.
        </Animated.Text>

        {/* Feature pills */}
        <View style={styles.features}>
          <Animated.View style={[styles.featurePill, fadeSlide(pill1Anim)]}>
            <Text style={styles.featureIcon}>&#128274;</Text>
            <Text style={styles.featureText}>100% Privado</Text>
          </Animated.View>
          <Animated.View style={[styles.featurePill, fadeSlide(pill2Anim)]}>
            <Text style={styles.featureIcon}>&#9889;</Text>
            <Text style={styles.featureText}>Offline</Text>
          </Animated.View>
          <Animated.View style={[styles.featurePill, fadeSlide(pill3Anim)]}>
            <Text style={styles.featureIcon}>&#129504;</Text>
            <Text style={styles.featureText}>IA Local</Text>
          </Animated.View>
        </View>

        {/* CTA Button */}
        <Animated.View style={fadeSlide(buttonAnim)}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartChat}
            activeOpacity={0.85}>
            <Text style={styles.startButtonText}>Iniciar Conversa</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.Text style={[styles.disclaimer, fadeSlide(buttonAnim)]}>
          O modelo precisa estar instalado para usar a IA.{'\n'}
          Acesse Configuracoes para instalar.
        </Animated.Text>
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
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
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
    shadowColor: colors.primary,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
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
