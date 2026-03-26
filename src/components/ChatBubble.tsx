import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, StyleSheet, Pressable, Platform, Clipboard} from 'react-native';
import {Message} from '../types';
import {colors, spacing, fonts, radius} from '../theme';
import {formatDate} from '../utils/helpers';
import TypingIndicator from './TypingIndicator';
import {logInfo} from '../services/logService';

interface ChatBubbleProps {
  message: Message;
}

type MarkdownBlock =
  | {type: 'heading'; level: 1 | 2 | 3; text: string}
  | {type: 'paragraph'; text: string}
  | {type: 'list'; ordered: boolean; items: string[]}
  | {type: 'code'; language: string; code: string};

type InlineChunk =
  | {type: 'text'; value: string}
  | {type: 'bold'; value: string}
  | {type: 'code'; value: string};

function parseInlineChunks(text: string): InlineChunk[] {
  const chunks: InlineChunk[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while (true) {
    match = pattern.exec(text);
    if (!match) {
      break;
    }

    if (match.index > lastIndex) {
      chunks.push({type: 'text', value: text.slice(lastIndex, match.index)});
    }

    const token = match[0];
    if (token.startsWith('`')) {
      chunks.push({type: 'code', value: token.slice(1, -1)});
    } else {
      chunks.push({type: 'bold', value: token.slice(2, -2)});
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    chunks.push({type: 'text', value: text.slice(lastIndex)});
  }

  if (chunks.length === 0) {
    chunks.push({type: 'text', value: text});
  }
  return chunks;
}

function parseTextSegment(segment: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = segment.split('\n');
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered: boolean | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const text = paragraphLines.join('\n').trim();
    if (text) {
      blocks.push({type: 'paragraph', text});
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    blocks.push({type: 'list', ordered: listOrdered === true, items: [...listItems]});
    listItems = [];
    listOrdered = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({
        type: 'heading',
        level,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const orderedMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (orderedMatch || unorderedMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      const itemText = ordered ? orderedMatch![2].trim() : unorderedMatch![1].trim();
      if (listItems.length > 0 && listOrdered !== ordered) {
        flushList();
      }
      listOrdered = ordered;
      listItems.push(itemText);
      continue;
    }

    if (listItems.length > 0) {
      const lastIndex = listItems.length - 1;
      listItems[lastIndex] = `${listItems[lastIndex]} ${line}`.trim();
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const blocks: MarkdownBlock[] = [];
  const codeBlockPattern = /```([a-zA-Z0-9_.#+-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while (true) {
    match = codeBlockPattern.exec(normalized);
    if (!match) {
      break;
    }

    const before = normalized.slice(cursor, match.index);
    if (before.trim()) {
      blocks.push(...parseTextSegment(before));
    }

    const language = (match[1] ?? '').trim();
    const code = (match[2] ?? '').replace(/\n$/, '');
    if (code.trim()) {
      blocks.push({type: 'code', language, code});
    }
    cursor = match.index + match[0].length;
  }

  const trailing = normalized.slice(cursor);
  if (trailing.trim()) {
    blocks.push(...parseTextSegment(trailing));
  }

  if (blocks.length === 0) {
    return [{type: 'paragraph', text: normalized}];
  }
  return blocks;
}

export default function ChatBubble({message}: ChatBubbleProps): React.JSX.Element {
  const TAG = 'ChatBubble';
  const renderCountRef = useRef(0);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  renderCountRef.current += 1;
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);

  const safeRole = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
    ? message.role
    : 'assistant';
  const safeContent = typeof message.content === 'string' ? message.content : '';
  const safeTimestamp =
    typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
      ? message.timestamp
      : Date.now();
  const safeId = typeof message.id === 'string' && message.id ? message.id : 'invalid-message-id';

  const isUser = safeRole === 'user';
  const isError = message.error === true;
  const isTyping = !isUser && safeContent === '' && !isError;
  const markdownBlocks = useMemo(() => parseMarkdownBlocks(safeContent), [safeContent]);

  const renderInline = useCallback((text: string, keyPrefix: string): React.ReactNode[] => {
    const chunks = parseInlineChunks(text);
    return chunks.map((chunk, index) => {
      const key = `${keyPrefix}-${index}`;
      if (chunk.type === 'code') {
        return (
          <Text key={key} style={styles.inlineCode}>
            {chunk.value}
          </Text>
        );
      }
      if (chunk.type === 'bold') {
        return (
          <Text key={key} style={styles.inlineBold}>
            {chunk.value}
          </Text>
        );
      }
      return (
        <Text key={key} style={styles.inlinePlain}>
          {chunk.value}
        </Text>
      );
    });
  }, []);

  const handleCopyCode = useCallback((code: string, blockIndex: number) => {
    Clipboard.setString(code);
    setCopiedBlockIndex(blockIndex);
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = setTimeout(() => {
      setCopiedBlockIndex(null);
    }, 1400);
  }, []);

  useEffect(() => {
    logInfo(
      TAG,
      'Render do ChatBubble concluido',
      `render=${renderCountRef.current} id=${safeId} role=${safeRole} isTyping=${isTyping}`,
    );
  }, [safeId, safeRole, isTyping]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          isUser ? styles.bubbleUserSizing : styles.bubbleAssistantSizing,
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
          <View style={styles.messageBody}>
            {markdownBlocks.map((block, blockIndex) => {
              if (block.type === 'heading') {
                const headingStyle =
                  block.level === 1
                    ? styles.heading1
                    : block.level === 2
                    ? styles.heading2
                    : styles.heading3;
                return (
                  <Text
                    key={`h-${blockIndex}`}
                    selectable
                    style={[styles.messageText, headingStyle, isError && styles.messageTextError]}>
                    {renderInline(block.text, `h-${blockIndex}`)}
                  </Text>
                );
              }

              if (block.type === 'list') {
                return (
                  <View key={`l-${blockIndex}`} style={styles.listBlock}>
                    {block.items.map((item, itemIndex) => (
                      <View key={`li-${blockIndex}-${itemIndex}`} style={styles.listRow}>
                        <Text style={[styles.listMarker, isError && styles.messageTextError]}>
                          {block.ordered ? `${itemIndex + 1}.` : '\u2022'}
                        </Text>
                        <Text
                          selectable
                          style={[styles.messageText, styles.listText, isError && styles.messageTextError]}>
                          {renderInline(item, `li-${blockIndex}-${itemIndex}`)}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              }

              if (block.type === 'code') {
                return (
                  <View key={`c-${blockIndex}`} style={styles.codeBlock}>
                    <View style={styles.codeHeader}>
                      <Text style={styles.codeLanguage}>
                        {block.language || 'texto'}
                      </Text>
                      <Pressable
                        onPress={() => handleCopyCode(block.code, blockIndex)}
                        hitSlop={6}
                        style={styles.copyButton}>
                        <Text style={styles.copyButtonText}>
                          {copiedBlockIndex === blockIndex ? 'Copiado' : 'Copiar'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text
                      selectable
                      style={[styles.codeText, isError && styles.messageTextError]}>
                      {block.code}
                    </Text>
                  </View>
                );
              }

              return (
                <Text
                  key={`p-${blockIndex}`}
                  selectable
                  style={[styles.messageText, styles.paragraphText, isError && styles.messageTextError]}>
                  {renderInline(block.text, `p-${blockIndex}`)}
                </Text>
              );
            })}
          </View>
        )}
        {!isTyping && (
          <Text style={styles.timestamp}>{formatDate(safeTimestamp)}</Text>
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
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bubbleUserSizing: {
    maxWidth: '84%',
  },
  bubbleAssistantSizing: {
    maxWidth: '94%',
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
  messageBody: {},
  paragraphText: {
    fontSize: fonts.sizes.base,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  heading1: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  heading2: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  heading3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  listBlock: {
    marginBottom: spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  listMarker: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.base,
    lineHeight: 24,
    minWidth: 18,
    fontWeight: '700',
  },
  listText: {
    flex: 1,
    lineHeight: 24,
  },
  codeBlock: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  codeHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeLanguage: {
    color: colors.textSecondary,
    fontSize: fonts.sizes.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  copyButton: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  copyButtonText: {
    color: colors.primary,
    fontSize: fonts.sizes.xs,
    fontWeight: '700',
  },
  codeText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  inlinePlain: {
    color: colors.text,
  },
  inlineBold: {
    color: colors.text,
    fontWeight: '700',
  },
  inlineCode: {
    color: colors.primary,
    backgroundColor: colors.surfaceElevated,
    fontSize: 14,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
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
