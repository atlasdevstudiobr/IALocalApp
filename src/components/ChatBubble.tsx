import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Clipboard,
  ScrollView,
  Linking,
  Image,
} from 'react-native';
import {Message, MessageSource} from '../types';
import {colors, spacing, fonts, radius} from '../theme';
import {formatDate} from '../utils/helpers';
import TypingIndicator from './TypingIndicator';
import {
  getCachedLocalSafetyDisabled,
  loadLocalSafetyDisabled,
  subscribeLocalSafetyDisabled,
} from '../services/safetySettingsService';

interface ChatBubbleProps {
  message: Message;
}

type MarkdownBlock =
  | {type: 'heading'; level: 1 | 2 | 3; text: string}
  | {type: 'paragraph'; text: string}
  | {type: 'list'; ordered: boolean; items: Array<{text: string; marker: number | null}>}
  | {type: 'divider'}
  | {type: 'code'; language: string; code: string};

type InlineChunk =
  | {type: 'text'; value: string}
  | {type: 'bold'; value: string}
  | {type: 'code'; value: string};

const DISPLAY_SANITIZATION_FALLBACK = 'Nao consegui exibir parte desta resposta com seguranca.';
const INTERNAL_DISPLAY_LABEL_PATTERN =
  /^(?:\*\*|__)?\s*(sistema|system|diretriz interna|instru(?:cao|ção)(?: interna)?|instrucoes internas|instruções internas|prompt|resposta esperada)\s*(?:\*\*|__)?\s*:/i;
const INTERNAL_DISPLAY_ROLE_PATTERN = /^(usuario|user|sistema|system)\s*:/i;
const ASSISTANT_DISPLAY_ROLE_PATTERN = /^(assistente|assistant)\s*:\s*/i;
const INTERNAL_DISPLAY_PERSONA_PATTERN = /(?:voce|você)\s+e\s+o\s+alfa\s+ai/i;
const TECHNICAL_DISPLAY_LEAK_PATTERN =
  /\b(n_predict|stopped_limit|tokens_predicted|context_full|prompt chars|last user chars|contexto usado|engine:\s*llama\.rn)\b/i;
const INTERNAL_SIGNAL_DISPLAY_PATTERN =
  /(voce e o alfa ai|você é o alfa ai|nunca revele, copie ou descreva instrucoes internas|evite formalidade excessiva|pergunta curta pede resposta curta|organize em markdown com titulos curtos|diretriz interna)/i;
const INVALID_SOURCE_SITE_PATTERN = /^(fonte|source|placeholder)$/i;

function getSourceDisplayName(source: MessageSource): string {
  const site = typeof source.siteName === 'string' ? source.siteName.trim() : '';
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  return site || title || source.url;
}

function getSourceLogoUri(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    if (!host) {
      return '';
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return '';
  }
}

function normalizeDisplayLeakLine(rawLine: string): string {
  return rawLine
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

function sanitizeAssistantDisplayContent(content: string): string {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, ' ')
    .replace(/<\|[^|]+?\|>/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }

  const safeLines: string[] = [];
  for (const rawLine of normalized.split('\n')) {
    const line = normalizeDisplayLeakLine(rawLine);
    if (!line) {
      safeLines.push('');
      continue;
    }

    if (INTERNAL_DISPLAY_ROLE_PATTERN.test(line)) {
      break;
    }
    if (ASSISTANT_DISPLAY_ROLE_PATTERN.test(line)) {
      const withoutRole = line.replace(ASSISTANT_DISPLAY_ROLE_PATTERN, '').trim();
      if (withoutRole) {
        safeLines.push(withoutRole);
      }
      continue;
    }
    if (
      INTERNAL_DISPLAY_LABEL_PATTERN.test(line) ||
      INTERNAL_DISPLAY_PERSONA_PATTERN.test(line) ||
      TECHNICAL_DISPLAY_LEAK_PATTERN.test(line) ||
      INTERNAL_SIGNAL_DISPLAY_PATTERN.test(line)
    ) {
      continue;
    }

    safeLines.push(rawLine.trimEnd());
  }

  return safeLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRenderableSource(source: MessageSource | null | undefined): source is MessageSource {
  if (!source) {
    return false;
  }
  const url = typeof source.url === 'string' ? source.url.trim() : '';
  const siteName = typeof source.siteName === 'string' ? source.siteName.trim() : '';
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!url || !siteName || !title) {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (INVALID_SOURCE_SITE_PATTERN.test(siteName.toLowerCase())) {
    return false;
  }
  return true;
}

interface SourceChipProps {
  source: MessageSource;
  onOpen: (url: string) => void;
}

const SourceChip = memo(function SourceChip({source, onOpen}: SourceChipProps): React.JSX.Element {
  const [logoFailed, setLogoFailed] = useState(false);
  const displayName = getSourceDisplayName(source);
  const logoUri = getSourceLogoUri(source.url);
  const logoInitial = displayName.charAt(0).toUpperCase();

  return (
    <Pressable
      hitSlop={6}
      style={styles.sourceChip}
      onPress={() => onOpen(source.url)}>
      <View style={styles.sourceLogoContainer}>
        {!logoFailed && logoUri ? (
          <Image
            source={{uri: logoUri}}
            style={styles.sourceLogo}
            resizeMode="contain"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Text style={styles.sourceLogoFallback}>
            {logoInitial || 'S'}
          </Text>
        )}
      </View>
      <Text style={styles.sourceChipText} numberOfLines={1}>
        {displayName}
      </Text>
    </Pressable>
  );
});

function parseInlineChunks(text: string): InlineChunk[] {
  const chunks: InlineChunk[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g;
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
  let listItems: Array<{text: string; marker: number | null}> = [];
  let listOrdered: boolean | null = null;
  let orderedListStart = 1;

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

    const strongSubtitleMatch = line.match(/^\*\*([^*\n:]{2,64})\*\*:?$/);
    if (strongSubtitleMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: 2,
        text: strongSubtitleMatch[1].trim(),
      });
      continue;
    }

    const subtitleMatch = line.match(
      /^(?:\*\*|__)?\s*([A-Za-zÀ-ÿ0-9][^:]{1,64})\s*:\s*(?:\*\*|__)?$/,
    );
    if (subtitleMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: 3,
        text: subtitleMatch[1].trim(),
      });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({type: 'divider'});
      continue;
    }

    const orderedMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*+•]\s+(.+)$/);
    if (orderedMatch || unorderedMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      const itemText = ordered ? orderedMatch![2].trim() : unorderedMatch![1].trim();
      if (listItems.length > 0 && listOrdered !== ordered) {
        flushList();
      }
      listOrdered = ordered;
      if (ordered && listItems.length === 0) {
        const parsedStart = Number(orderedMatch![1]);
        orderedListStart = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 1;
      }
      listItems.push({
        text: itemText,
        marker: ordered ? orderedListStart + listItems.length : null,
      });
      continue;
    }

    if (listItems.length > 0) {
      const lastIndex = listItems.length - 1;
      listItems[lastIndex] = {
        ...listItems[lastIndex],
        text: `${listItems[lastIndex].text} ${line}`.trim(),
      };
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function normalizeListBlocks(blocks: MarkdownBlock[]): MarkdownBlock[] {
  const normalized: MarkdownBlock[] = [];
  let orderedMarkerCursor: number | null = null;

  for (const block of blocks) {
    if (block.type !== 'list') {
      orderedMarkerCursor = null;
      normalized.push(block);
      continue;
    }

    if (!block.ordered) {
      orderedMarkerCursor = null;
      const previous = normalized[normalized.length - 1];
      if (previous?.type === 'list' && !previous.ordered) {
        previous.items = [...previous.items, ...block.items];
      } else {
        normalized.push({
          ...block,
          items: [...block.items],
        });
      }
      continue;
    }

    const startMarker: number = orderedMarkerCursor ?? block.items[0]?.marker ?? 1;
    const normalizedItems = block.items.map((item, index) => ({
      ...item,
      marker: startMarker + index,
    }));
    orderedMarkerCursor = startMarker + normalizedItems.length;

    const previous = normalized[normalized.length - 1];
    if (previous?.type === 'list' && previous.ordered) {
      previous.items = [...previous.items, ...normalizedItems];
    } else {
      normalized.push({
        ...block,
        items: normalizedItems,
      });
    }
  }

  return normalized;
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

  const normalizedBlocks = normalizeListBlocks(blocks);

  if (normalizedBlocks.length === 0) {
    return [{type: 'paragraph', text: normalized}];
  }
  return normalizedBlocks;
}

function ChatBubble({message}: ChatBubbleProps): React.JSX.Element {
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);
  const [isLocalSafetyDisabled, setIsLocalSafetyDisabled] = useState<boolean>(
    getCachedLocalSafetyDisabled(),
  );

  const safeRole = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
    ? message.role
    : 'assistant';
  const rawContent = typeof message.content === 'string' ? message.content : '';
  const safeTimestamp =
    typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
      ? message.timestamp
      : Date.now();
  const safeSources = Array.isArray(message.sources)
    ? message.sources.filter(source => isRenderableSource(source)).slice(0, 3)
    : [];

  const isUser = safeRole === 'user';
  const isError = message.error === true;
  const sanitizedAssistantContent = useMemo(
    () => (isUser || isLocalSafetyDisabled ? rawContent : sanitizeAssistantDisplayContent(rawContent)),
    [isUser, rawContent, isLocalSafetyDisabled],
  );
  const safeContent =
    !isUser && !isLocalSafetyDisabled && rawContent.trim() && !sanitizedAssistantContent.trim()
      ? DISPLAY_SANITIZATION_FALLBACK
      : sanitizedAssistantContent;
  const isTyping = !isUser && rawContent.trim() === '' && !isError;
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

  const handleOpenSource = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      // Ignora falha de abertura de link para nao interromper render do chat.
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    void loadLocalSafetyDisabled().then(value => {
      if (isMounted) {
        setIsLocalSafetyDisabled(value);
      }
    });
    const unsubscribe = subscribeLocalSafetyDisabled(value => {
      setIsLocalSafetyDisabled(value);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

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
                const headingContainerStyle =
                  block.level === 1
                    ? styles.headingBlockStrong
                    : block.level === 2
                    ? styles.headingBlockMedium
                    : styles.headingBlockSoft;
                return (
                  <View
                    key={`h-${blockIndex}`}
                    style={[
                      styles.headingBlock,
                      headingContainerStyle,
                      isError && styles.headingBlockError,
                    ]}>
                    <Text
                      selectable
                      style={[styles.messageText, headingStyle, isError && styles.messageTextError]}>
                      {renderInline(block.text, `h-${blockIndex}`)}
                    </Text>
                  </View>
                );
              }

              if (block.type === 'list') {
                return (
                  <View key={`l-${blockIndex}`} style={styles.listBlock}>
                    {block.items.map((item, itemIndex) => (
                      <View key={`li-${blockIndex}-${itemIndex}`} style={styles.listRow}>
                        <Text
                          style={[
                            styles.listMarker,
                            block.ordered ? styles.listMarkerOrdered : styles.listMarkerBullet,
                            isError && styles.messageTextError,
                          ]}>
                          {block.ordered ? `${item.marker ?? itemIndex + 1}.` : '\u2022'}
                        </Text>
                        <Text
                          selectable
                          style={[styles.messageText, styles.listText, isError && styles.messageTextError]}>
                          {renderInline(item.text, `li-${blockIndex}-${itemIndex}`)}
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
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.codeScrollContent}>
                      <Text
                        selectable
                        style={[styles.codeText, isError && styles.messageTextError]}>
                        {block.code}
                      </Text>
                    </ScrollView>
                  </View>
                );
              }

              if (block.type === 'divider') {
                return <View key={`d-${blockIndex}`} style={styles.divider} />;
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
      {!isTyping && !isUser && safeSources.length > 0 && (
        <View style={styles.sourcesOutsideContainer}>
          {safeSources.map((source, index) => (
            <SourceChip
              key={`${source.url}-${index}`}
              source={source}
              onOpen={handleOpenSource}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function areEqual(prev: ChatBubbleProps, next: ChatBubbleProps): boolean {
  const prevSources = prev.message.sources ?? [];
  const nextSources = next.message.sources ?? [];
  const sameSources =
    prevSources.length === nextSources.length &&
    prevSources.every(
      (source, index) =>
        source.url === nextSources[index]?.url &&
        source.title === nextSources[index]?.title &&
        source.siteName === nextSources[index]?.siteName,
    );
  return (
    prev.message.id === next.message.id &&
    prev.message.role === next.message.role &&
    prev.message.content === next.message.content &&
    prev.message.timestamp === next.message.timestamp &&
    prev.message.error === next.message.error &&
    prev.message.webValidationStatus === next.message.webValidationStatus &&
    prev.message.searchDecision === next.message.searchDecision &&
    sameSources
  );
}

export default memo(ChatBubble, areEqual);

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
    borderWidth: 1,
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
    borderColor: colors.userBubbleBorder,
  },
  bubbleAssistant: {
    backgroundColor: colors.aiBubble,
    borderBottomLeftRadius: radius.sm,
    borderColor: 'rgba(30, 190, 150, 0.24)',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 3},
    elevation: 3,
  },
  bubbleError: {
    borderColor: colors.danger,
  },
  messageText: {
    color: colors.text,
    fontSize: fonts.sizes.base,
    lineHeight: 22,
  },
  messageBody: {
    paddingTop: 2,
  },
  paragraphText: {
    fontSize: fonts.sizes.base,
    lineHeight: 25,
    marginBottom: spacing.lg,
  },
  headingBlock: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
  },
  headingBlockStrong: {
    borderLeftColor: colors.primary,
    backgroundColor: 'rgba(16, 163, 127, 0.12)',
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
  },
  headingBlockMedium: {
    borderLeftColor: colors.primaryDark,
    backgroundColor: 'rgba(16, 163, 127, 0.08)',
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
  },
  headingBlockSoft: {
    borderLeftColor: colors.border,
  },
  headingBlockError: {
    borderLeftColor: colors.danger,
  },
  heading1: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: colors.primary,
    marginBottom: 3,
  },
  heading2: {
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '700',
    marginBottom: 3,
  },
  heading3: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  listBlock: {
    marginBottom: spacing.lg,
    paddingLeft: spacing.xs,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  listMarker: {
    color: colors.text,
    fontSize: fonts.sizes.base,
    lineHeight: 26,
    minWidth: 24,
    fontWeight: '700',
    marginTop: 1,
  },
  listMarkerOrdered: {
    color: colors.primary,
  },
  listMarkerBullet: {
    color: colors.textSecondary,
  },
  listText: {
    flex: 1,
    lineHeight: 26,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
    opacity: 0.9,
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
  codeScrollContent: {
    paddingRight: spacing.md,
  },
  inlinePlain: {
    color: colors.text,
  },
  inlineBold: {
    color: colors.text,
    fontWeight: '800',
  },
  inlineCode: {
    color: colors.primary,
    backgroundColor: colors.surfaceElevated,
    fontSize: 13,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  messageTextError: {
    color: colors.danger,
  },
  sourcesOutsideContainer: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: '94%',
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 248,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.sm,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  sourceLogoContainer: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sourceLogo: {
    width: 14,
    height: 14,
  },
  sourceLogoFallback: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  sourceChipText: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: fonts.sizes.sm,
    lineHeight: 16,
    fontWeight: '600',
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: fonts.sizes.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
});
