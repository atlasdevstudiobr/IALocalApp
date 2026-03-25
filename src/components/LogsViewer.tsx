import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Share,
  StyleSheet,
} from 'react-native';
import {AppLog} from '../types';
import {
  subscribeToLogs,
  clearLogs,
  exportLogs,
} from '../services/logService';
import {colors, spacing, fonts, radius} from '../theme';
import {formatDate} from '../utils/helpers';

const MAX_DISPLAY_LOGS = 100;

export default function LogsViewer(): React.JSX.Element {
  const [logs, setLogs] = useState<AppLog[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToLogs(updatedLogs => {
      setLogs(updatedLogs.slice(0, MAX_DISPLAY_LOGS));
    });
    return unsubscribe;
  }, []);

  const handleClearLogs = useCallback(async () => {
    await clearLogs();
  }, []);

  const handleShareLogs = useCallback(async () => {
    const text = exportLogs();
    try {
      await Share.share({
        message: text,
        title: 'Alfa AI - Logs',
      });
    } catch (_error) {
      // User cancelled share
    }
  }, []);

  const getLevelColor = useCallback((level: AppLog['level']): string => {
    switch (level) {
      case 'error':
        return colors.danger;
      case 'warn':
        return colors.warning;
      default:
        return colors.textSecondary;
    }
  }, []);

  const getLevelBg = useCallback((level: AppLog['level']): string => {
    switch (level) {
      case 'error':
        return 'rgba(239,68,68,0.1)';
      case 'warn':
        return 'rgba(245,158,11,0.1)';
      default:
        return colors.surfaceElevated;
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>
          Logs ({logs.length})
        </Text>
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            style={styles.toolbarButton}
            onPress={handleShareLogs}
            activeOpacity={0.7}>
            <Text style={styles.toolbarButtonText}>Compartilhar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolbarButton, styles.toolbarButtonDanger]}
            onPress={handleClearLogs}
            activeOpacity={0.7}>
            <Text style={[styles.toolbarButtonText, styles.toolbarButtonTextDanger]}>
              Limpar
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Logs list */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled>
        {logs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Nenhum log disponivel.</Text>
          </View>
        ) : (
          logs.map(log => (
            <View
              key={log.id}
              style={[styles.logEntry, {backgroundColor: getLevelBg(log.level)}]}>
              <View style={styles.logHeader}>
                <Text style={[styles.logLevel, {color: getLevelColor(log.level)}]}>
                  {log.level.toUpperCase()}
                </Text>
                <Text style={styles.logTag}>[{log.tag}]</Text>
                <Text style={styles.logTime}>{formatDate(log.timestamp)}</Text>
              </View>
              <Text style={styles.logMessage}>{log.message}</Text>
              {log.details ? (
                <Text style={styles.logDetails}>{log.details}</Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  toolbarTitle: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
  },
  toolbarActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolbarButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  toolbarButtonDanger: {
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  toolbarButtonText: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    fontWeight: '500',
  },
  toolbarButtonTextDanger: {
    color: colors.danger,
  },
  scrollView: {
    maxHeight: 300,
  },
  scrollContent: {
    padding: spacing.sm,
  },
  emptyState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyStateText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.sm,
  },
  logEntry: {
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: 4,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  logLevel: {
    fontSize: fonts.sizes.xs,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  logTag: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    fontFamily: 'monospace',
  },
  logTime: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    marginLeft: 'auto',
  },
  logMessage: {
    color: colors.text,
    fontSize: fonts.sizes.xs,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  logDetails: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    fontFamily: 'monospace',
    marginTop: 2,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
});
