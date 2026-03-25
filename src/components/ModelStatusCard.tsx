import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {colors, spacing, fonts, radius} from '../theme';

interface ModelStatusCardProps {
  onDownloadPress?: () => void;
}

export default function ModelStatusCard({
  onDownloadPress,
}: ModelStatusCardProps): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.modelIconContainer}>
          <Text style={styles.modelIcon}>&#129302;</Text>
        </View>
        <View style={styles.modelInfo}>
          <Text style={styles.modelName}>Qwen2.5-3B-Instruct Q4_K_M</Text>
          <Text style={styles.modelSize}>Tamanho estimado: ~2.0 GB</Text>
        </View>
      </View>

      {/* Status Badge */}
      <View style={styles.statusRow}>
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Nao instalado</Text>
        </View>
      </View>

      {/* Progress bar placeholder */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, {width: '0%'}]} />
        </View>
        <Text style={styles.progressText}>0%</Text>
      </View>

      {/* Info text */}
      <Text style={styles.infoText}>
        O modelo de IA local precisa ser baixado antes de usar o app offline.
        Necessario ~2 GB de espaco livre.
      </Text>

      {/* Download button */}
      <TouchableOpacity
        style={styles.downloadButton}
        onPress={onDownloadPress}
        disabled
        activeOpacity={0.8}>
        <Text style={styles.downloadButtonText}>Baixar modelo</Text>
        <Text style={styles.downloadButtonSubtext}>(Em breve)</Text>
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
  infoText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    opacity: 0.6,
  },
  downloadButtonText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
  downloadButtonSubtext: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
  },
});
