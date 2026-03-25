import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {Message} from '../types';
import {colors, spacing, fonts, radius} from '../theme';
import {formatDate} from '../utils/helpers';
import TypingIndicator from './TypingIndicator';

interface ChatBubbleProps {
  message: Message;
}

export default function ChatBubble({message}: ChatBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  const isError = message.error === true;
  const isTyping = !isUser && message.content === '' && !isError;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          isError && styles.bubbleError,
        ]}>
        {!isUser && (
          <View style={styles.roleTag}>
            <Text style={styles.roleTagText}>Alfa AI</Text>
          </View>
        )}
        {isTyping ? (
          <TypingIndicator />
        ) : (
          <Text
            selectable
            style={[styles.messageText, isError && styles.messageTextError]}>
            {message.content}
          </Text>
        )}
        {!isTyping && (
          <Text style={styles.timestamp}>{formatDate(message.timestamp)}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    width: '100%',
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  rowAssistant: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bubbleUser: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.userBubbleBorder,
  },
  bubbleAssistant: {
    backgroundColor: colors.aiBubble,
    borderBottomLeftRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  bubbleError: {
    borderLeftColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  roleTag: {
    marginBottom: spacing.xs,
  },
  roleTagText: {
    color: colors.primary,
    fontSize: fonts.sizes.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  messageText: {
    color: colors.text,
    fontSize: fonts.sizes.base,
    lineHeight: 22,
  },
  messageTextError: {
    color: colors.danger,
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
});
