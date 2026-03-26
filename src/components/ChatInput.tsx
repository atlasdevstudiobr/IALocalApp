import React, {useRef, useCallback, memo} from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {colors, spacing, fonts, radius} from '../theme';
import {logError} from '../services/logService';

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  isLoading?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}

function ChatInput({
  value,
  onChangeText,
  onSend,
  isLoading = false,
  autoFocus = false,
  placeholder = 'Mensagem...',
}: ChatInputProps): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(() => {
    try {
      if (!value.trim() || isLoading) {
        return;
      }
      onSend();
    } catch (error) {
      const details =
        error instanceof Error
          ? `${error.message}\n${error.stack ?? 'stack indisponivel'}`
          : String(error);
      logError('ChatInput', 'Erro no handleSend do ChatInput', details);
    }
  }, [value, isLoading, onSend]);

  const canSend = value.trim().length > 0 && !isLoading;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          numberOfLines={1}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
          editable={!isLoading}
          autoFocus={autoFocus}
          textAlignVertical="center"
          selectionColor={colors.primary}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            canSend ? styles.sendButtonActive : styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.8}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.sendIcon}>{'\u2191'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function areEqual(prev: ChatInputProps, next: ChatInputProps): boolean {
  return (
    prev.value === next.value &&
    prev.isLoading === next.isLoading &&
    prev.autoFocus === next.autoFocus &&
    prev.placeholder === next.placeholder &&
    prev.onChangeText === next.onChangeText &&
    prev.onSend === next.onSend
  );
}

export default memo(ChatInput, areEqual);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: -3},
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.inputBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    shadowColor: colors.primary,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fonts.sizes.base,
    lineHeight: 22,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: spacing.sm,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
    marginBottom: spacing.xs,
  },
  sendButtonActive: {
    backgroundColor: colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: fonts.sizes.lg,
    fontWeight: '700',
    lineHeight: 20,
  },
});
