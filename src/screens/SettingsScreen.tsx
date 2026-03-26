import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions} from '@react-navigation/native';

import ModelStatusCard from '../components/ModelStatusCard';
import LogsViewer from '../components/LogsViewer';
import {colors, spacing, fonts, radius} from '../theme';
import {LOCAL_MODEL_DISPLAY_NAME} from '../config/modelConfig';
import {
  ModelDownloadState,
  cancelModelDownload,
  isModelDownloadInProgress,
  loadModelDownloadState,
  startModelDownload,
} from '../services/modelDownloadService';
import {
  loadLocalSafetyDisabled,
  setLocalSafetyDisabled,
} from '../services/safetySettingsService';

const APP_VERSION = '1.0.2';
const RN_VERSION = '0.73.6';

export default function SettingsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [modelState, setModelState] = useState<ModelDownloadState | null>(null);
  const [isLocalSafetyDisabled, setIsLocalSafetyDisabled] = useState(false);
  const [isSavingSafetyMode, setIsSavingSafetyMode] = useState(false);

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      const [currentState, unsafeMode] = await Promise.all([
        loadModelDownloadState(),
        loadLocalSafetyDisabled(),
      ]);
      if (isMounted) {
        setModelState(currentState);
        setIsLocalSafetyDisabled(unsafeMode);
      }
    };

    void loadState();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleModelAction = useCallback(async () => {
    if (!modelState) {
      return;
    }

    if (modelState.status === 'downloading') {
      if (!isModelDownloadInProgress()) {
        const refreshedState = await loadModelDownloadState();
        setModelState(refreshedState);
        return;
      }
      await cancelModelDownload();
      return;
    }

    if (isModelDownloadInProgress()) {
      return;
    }

    setModelState(prev =>
      prev
        ? {
            ...prev,
            status: 'downloading',
            downloadProgress: 0,
            downloadedBytes: 0,
            errorMessage: undefined,
          }
        : prev,
    );

    const finalState = await startModelDownload({
      onProgress: update => {
        setModelState(prev =>
          prev
            ? {
                ...prev,
                status: 'downloading',
                ...update,
              }
            : prev,
        );
      },
    });

    setModelState(finalState);
  }, [modelState]);

  const persistSafetyMode = useCallback(async (nextValue: boolean) => {
    setIsSavingSafetyMode(true);
    setIsLocalSafetyDisabled(nextValue);
    try {
      await setLocalSafetyDisabled(nextValue);
    } catch (_error) {
      setIsLocalSafetyDisabled(!nextValue);
      Alert.alert('Erro', 'Nao foi possivel salvar a configuracao de teste.');
    } finally {
      setIsSavingSafetyMode(false);
    }
  }, []);

  const handleToggleSafetyMode = useCallback(() => {
    if (isSavingSafetyMode) {
      return;
    }
    const nextValue = !isLocalSafetyDisabled;
    if (!nextValue) {
      void persistSafetyMode(false);
      return;
    }

    Alert.alert(
      'Modo de teste',
      'Isso desativa filtros locais de seguranca e pode exibir saidas sensiveis do modelo. Use apenas para teste.',
      [
        {text: 'Cancelar', style: 'cancel'},
        {text: 'Ativar', style: 'destructive', onPress: () => void persistSafetyMode(true)},
      ],
    );
  }, [isLocalSafetyDisabled, isSavingSafetyMode, persistSafetyMode]);

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
        <Text style={styles.headerTitle}>Configuracoes</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {paddingBottom: insets.bottom + spacing.xxl},
        ]}
        showsVerticalScrollIndicator={false}>

        {/* Model section */}
        <Text style={styles.sectionTitle}>Modelo de IA</Text>
        <ModelStatusCard
          modelName={modelState?.name ?? LOCAL_MODEL_DISPLAY_NAME}
          filePath={modelState?.filePath}
          status={modelState?.status ?? 'not_downloaded'}
          progress={modelState?.downloadProgress ?? 0}
          downloadedBytes={modelState?.downloadedBytes ?? 0}
          totalBytes={modelState?.totalBytes ?? 0}
          errorMessage={modelState?.errorMessage}
          onActionPress={handleModelAction}
        />

        {/* App info section */}
        <Text style={styles.sectionTitle}>Informacoes do App</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Versao do App" value={`v${APP_VERSION}`} />
          <InfoRow label="React Native" value={`v${RN_VERSION}`} />
          <InfoRow label="Arquitetura" value="Old Arch (Hermes)" />
          <InfoRow label="Target SDK" value="34 (Android 14)" />
          <InfoRow label="Min SDK" value="24 (Android 7.0)" />
        </View>

        {/* Safety test section */}
        <Text style={styles.sectionTitle}>Modo de Teste</Text>
        <View style={styles.infoCard}>
          <View style={styles.testModeHeader}>
            <Text style={styles.testModeTitle}>Filtros locais de seguranca</Text>
            <Text style={[styles.testModeBadge, isLocalSafetyDisabled && styles.testModeBadgeOn]}>
              {isLocalSafetyDisabled ? 'DESATIVADO' : 'ATIVO'}
            </Text>
          </View>
          <Text style={styles.testModeDescription}>
            Quando desativado, o app nao aplica sanitizacao local das respostas.
          </Text>
          <TouchableOpacity
            style={[
              styles.testModeButton,
              isLocalSafetyDisabled ? styles.testModeButtonOff : styles.testModeButtonOn,
              isSavingSafetyMode && styles.testModeButtonDisabled,
            ]}
            onPress={handleToggleSafetyMode}
            activeOpacity={0.85}
            disabled={isSavingSafetyMode}>
            <Text style={styles.testModeButtonText}>
              {isSavingSafetyMode
                ? 'Salvando...'
                : isLocalSafetyDisabled
                ? 'Reativar filtros'
                : 'Desativar filtros (teste)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Logs section */}
        <Text style={styles.sectionTitle}>Logs do Sistema</Text>
        <LogsViewer />
      </ScrollView>
    </View>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
}

function InfoRow({label, value}: InfoRowProps): React.JSX.Element {
  return (
    <View style={infoRowStyles.row}>
      <Text style={infoRowStyles.label}>{label}</Text>
      <Text style={infoRowStyles.value}>{value}</Text>
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
    fontSize: fonts.sizes.lg,
    fontWeight: '700',
  },
  headerRight: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  testModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  testModeTitle: {
    color: colors.text,
    fontSize: fonts.sizes.base,
    fontWeight: '600',
  },
  testModeBadge: {
    color: colors.success,
    fontSize: fonts.sizes.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  testModeBadgeOn: {
    color: colors.warning,
  },
  testModeDescription: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
    lineHeight: 19,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  testModeButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  testModeButtonOn: {
    backgroundColor: colors.warning,
  },
  testModeButtonOff: {
    backgroundColor: colors.success,
  },
  testModeButtonDisabled: {
    opacity: 0.65,
  },
  testModeButtonText: {
    color: '#0D0D0D',
    fontSize: fonts.sizes.sm,
    fontWeight: '700',
  },
});

const infoRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
  },
  value: {
    color: colors.text,
    fontSize: fonts.sizes.sm,
    fontWeight: '500',
  },
});
