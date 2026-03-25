import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {ModelStatus} from '../types';
import {colors, spacing, fonts, radius} from '../theme';
import {formatBytes} from '../utils/helpers';

interface ModelStatusCardProps {
  modelName?: string;
  filePath?: string;
  status: ModelStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage?: string;
  onActionPress?: () => void;
}

export default function ModelStatusCard({
  modelName,
  filePath,
  status,
  progress,
  downloadedBytes,
  totalBytes,
  errorMessage,
  onActionPress,
}: ModelStatusCardProps): React.JSX.Element {
  const isDownloading = status === 'downloading';
  const isReady = status === 'ready';
  const isError = status === 'error';

  const statusText =
    status === 'downloading'
      ? 'Baixando'
      : status === 'ready'
      ? 'Instalado'
      : status === 'error'
      ? 'Erro no download'
      : 'Nao instalado';

  const statusDotColor =
    status === 'downloading'
      ? colors.warning
      : status === 'ready'
      ? colors.success
      : status === 'error'
      ? colors.danger
      : colors.textMuted;

  const buttonText =
    status === 'downloading'
      ? 'Cancelar download'
      : status === 'ready'
      ? 'Modelo instalado'
      : status === 'error'
      ? 'Tentar novamente'
      : 'Baixar modelo';

  const progressValue = isReady ? 100 : Math.max(0, Math.min(100, progress));
  const progressWidth = `${progressValue}%`;

  const bytesText = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;

  const infoText = isError
    ? errorMessage || 'Nao foi possivel baixar o modelo. Tente novamente.'
    : isReady
    ? `Modelo instalado com sucesso (${formatBytes(downloadedBytes)}).`
    : 'O modelo de IA local precisa ser baixado antes de usar o app offline. Necessario ~2 GB de espaco livre.';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.modelIconContainer}>
          <Text style={styles.modelIcon}>&#129302;</Text>
        </View>
        <View style={styles.modelInfo}>
          <Text style={styles.modelName}>{modelName || 'Qwen2.5-3B-Instruct Q4_K_M'}</Text>
          <Text style={styles.modelSize}>Tamanho estimado: ~2.0 GB</Text>
        </View>
      </View>

      {/* Status Badge */}
      <View style={styles.statusRow}>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, {backgroundColor: statusDotColor}]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      </View>

      {/* Progress */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, {width: progressWidth}]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progressValue)}%</Text>
      </View>
      <Text style={styles.sizeText}>{bytesText}</Text>

      {/* Info text */}
      <Text style={styles.infoText}>{infoText}</Text>
      {isReady && filePath ? <Text style={styles.pathText}>{filePath}</Text> : null}

      {/* Action button */}
      <TouchableOpacity
        style={[
          styles.downloadButton,
          isDownloading ? styles.downloadButtonDanger : null,
          isReady ? styles.downloadButtonReady : null,
        ]}
        onPress={onActionPress}
        disabled={isReady}
        activeOpacity={0.8}>
        <Text
          style={[
            styles.downloadButtonText,
            isReady ? styles.downloadButtonTextReady : null,
          ]}>
          {buttonText}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modelIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  modelIcon: {
    fontSize: 24,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    color: colors.text,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
    marginBottom: 2,
  },
  modelSize: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
  },
  statusRow: {
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
    marginRight: spacing.xs,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    fontWeight: '500',
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    minWidth: 32,
  },
  sizeText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    marginBottom: spacing.sm,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  pathText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    marginBottom: spacing.lg,
  },
  downloadButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  downloadButtonDanger: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
  },
  downloadButtonReady: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    opacity: 0.8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.base,
    fontWeight: '600',
  },
  downloadButtonTextReady: {
    color: colors.success,
  },
});
