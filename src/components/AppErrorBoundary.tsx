import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {colors, spacing, fonts, radius} from '../theme';
import {logError, logInfo} from '../services/logService';

const TAG = 'AppErrorBoundary';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

export default class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return {
      hasError: true,
      message,
    };
  }

  componentDidCatch(error: unknown): void {
    logError(TAG, 'Erro capturado pelo Error Boundary', toErrorDetails(error));
  }

  private handleRetry = (): void => {
    logInfo(TAG, 'Tentativa de recuperar app via Error Boundary');
    this.setState({
      hasError: false,
      message: '',
    });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Algo deu errado</Text>
        <Text style={styles.subtitle}>
          O app capturou uma falha inesperada. Veja os logs para detalhes.
        </Text>
        {this.state.message ? (
          <Text style={styles.errorText} numberOfLines={4}>
            {this.state.message}
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.button}
          onPress={this.handleRetry}
          activeOpacity={0.8}>
          <Text style={styles.buttonText}>Tentar continuar</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fonts.sizes.xl,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: fonts.sizes.sm,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.base,
    fontWeight: '700',
  },
});
