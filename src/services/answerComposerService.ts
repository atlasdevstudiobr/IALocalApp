import {MessageSource, SearchDecision, WebValidationStatus} from '../types';
import {WebSearchResult} from './webSearchService';

export interface AnswerCompositionInput {
  rawAnswer: string;
  decision: SearchDecision;
  webResult?: WebSearchResult;
}

export interface ComposedAnswer {
  text: string;
  sources: MessageSource[];
  webValidationStatus: WebValidationStatus;
}

export interface PromptAugmentation {
  externalContext?: string;
  policyInstruction?: string;
}

const WEB_ACCESS_CLAIM_PATTERN =
  /\b(pesquisei|acabei de pesquisar|consultei a internet|acessei a internet|busquei na web)\b/gi;
const NO_INTERNET_CLAIM_PATTERN =
  /\b(nao tenho acesso a internet|sem acesso a internet|nao consigo acessar a internet)\b/gi;
const CURRENT_YEAR_PATTERN = /\b(que ano estamos|ano atual|em que ano estamos)\b/i;
const CURRENT_DATE_PATTERN = /\b(data de hoje|que dia e hoje|qual a data de hoje)\b/i;
const CURRENCY_QUERY_PATTERN =
  /\b(d[o\u00F3]lar|euro|cota[c\u00E7][a\u00E3]o|bitcoin|btc|ibovespa|selic)\b/i;
const WEATHER_QUERY_PATTERN = /\b(clima|temperatura|previs[a\u00E3]o do tempo|tempo em)\b/i;
const POLITICAL_QUERY_PATTERN =
  /\b(presidente|governador|ministro|prefeito|senador|deputado|cargo)\b/i;
const WEB_VALIDATION_FALLBACK_NOTE =
  'Nao consegui validar isso agora pela internet, mas posso te responder com base no meu conhecimento local.';
const HONEST_VALIDATION_FALLBACK =
  'Nao consegui validar isso agora com seguranca. Posso tentar responder com base no conhecimento local ou voce pode reformular.';
const COMPOSITION_INTEGRITY_FALLBACK =
  'Nao consegui gerar uma resposta completa agora. Pode reformular para eu tentar novamente?';
const TEMPLATE_PLACEHOLDER_PATTERN = /(\{\{[^}\n]*\}\}|\[\[[^\]\n]*\]\]|<[^>\n]*(placeholder|template|fonte|source)[^>\n]*>)/i;
const PLACEHOLDER_SOURCE_PATTERN = /^(fonte|source|placeholder|site|link)$/i;
const FRAGMENT_ONLY_PATTERN =
  /^(de acordo com|segundo|com base em|em\s+[a-z\u00C0-\u017F]{3,20}\s+de\s+\d{4},?\s+o\s+[^.!?]{1,80}\s+(?:do|da|de))[.:;,\-]*$/i;
const INCOMPLETE_ENDING_PATTERN =
  /\b(de|do|da|dos|das|para|com|sobre|que|e|ou|em|no|na|nos|nas|por|ao|aos|a|o)\.?$/i;

function normalizeText(text: string): string {
  return text.replace(/\s+$/g, '').trim();
}

function sanitizeSourceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isValidSource(source: MessageSource | null | undefined): source is MessageSource {
  if (!source) {
    return false;
  }
  const url = sanitizeSourceText(source.url);
  const siteName = sanitizeSourceText(source.siteName);
  const title = sanitizeSourceText(source.title);
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }
  if (!siteName || PLACEHOLDER_SOURCE_PATTERN.test(siteName.toLowerCase())) {
    return false;
  }
  if (!title || PLACEHOLDER_SOURCE_PATTERN.test(title.toLowerCase())) {
    return false;
  }
  return true;
}

function normalizeSources(sources: MessageSource[] | undefined): MessageSource[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }
  const dedupe = new Set<string>();
  const normalized: MessageSource[] = [];
  for (const source of sources) {
    if (!isValidSource(source)) {
      continue;
    }
    const key = source.url.trim().toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    normalized.push({
      title: sanitizeSourceText(source.title),
      url: sanitizeSourceText(source.url),
      siteName: sanitizeSourceText(source.siteName),
    });
  }
  return normalized;
}

export function countValidWebSources(webResult?: WebSearchResult): number {
  return normalizeSources(webResult?.sources).length;
}

export function hasValidatedWebSources(webResult?: WebSearchResult): boolean {
  return Boolean(webResult?.ok && countValidWebSources(webResult) > 0);
}

function sanitizeWebHonesty(
  text: string,
  decision: SearchDecision,
  hasValidatedWeb: boolean,
): string {
  if (!text) {
    return '';
  }
  if (decision === 'local_plus_web' && hasValidatedWeb) {
    return text.replace(NO_INTERNET_CLAIM_PATTERN, 'com validacao factual recente');
  }
  return text.replace(WEB_ACCESS_CLAIM_PATTERN, 'considerei o contexto disponivel');
}

function buildWebEvidenceContext(webResult: WebSearchResult): string {
  const lines: string[] = [];
  lines.push(`Consulta validada: "${webResult.query}"`);
  lines.push(`Momento da coleta (UTC): ${webResult.fetchedAtIso}`);

  for (const [index, evidence] of webResult.evidences.entries()) {
    const datePart = evidence.publishedAt ? ` | Data: ${evidence.publishedAt}` : '';
    lines.push(
      `[${index + 1}] ${evidence.title}${datePart}\nFonte: ${evidence.url}\nResumo: ${evidence.snippet}`,
    );
  }

  return lines.join('\n');
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/\s*\[[0-9]+\]\s*/g, ' ')
    .replace(/\s*[|•·]\s*/g, ' ')
    .replace(/\s+-\s+[^-]{0,40}$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureCompleteSentence(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (/[.!?]$/.test(normalized)) {
    return normalized;
  }
  if (/[:;,\-]\s*$/.test(normalized)) {
    return `${normalized.replace(/[:;,\-]\s*$/, '')}.`;
  }
  return `${normalized}.`;
}

function firstMeaningfulSentence(text: string, maxLength = 220): string {
  const normalized = sanitizeEvidenceText(text);
  if (!normalized) {
    return '';
  }

  const sentenceMatch = normalized.match(/^(.{16,220}?[.!?])(?:\s|$)/);
  if (sentenceMatch?.[1]) {
    return ensureCompleteSentence(sentenceMatch[1].trim());
  }

  if (normalized.length <= maxLength) {
    return ensureCompleteSentence(normalized);
  }

  const clipped = normalized.slice(0, maxLength).trim();
  const lastNaturalBreak = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf(', '));
  if (lastNaturalBreak >= 24) {
    return ensureCompleteSentence(clipped.slice(0, lastNaturalBreak).trim());
  }
  return ensureCompleteSentence(clipped);
}

function pickBestEvidenceSnippet(query: string, webResult: WebSearchResult): string {
  const normalizedQuery = query.toLowerCase();
  const snippets = webResult.evidences
    .slice(0, 3)
    .flatMap(evidence => [evidence.snippet, evidence.title])
    .map(item => sanitizeEvidenceText(item))
    .filter(Boolean);

  if (snippets.length === 0) {
    return '';
  }

  if (CURRENCY_QUERY_PATTERN.test(normalizedQuery) || WEATHER_QUERY_PATTERN.test(normalizedQuery)) {
    const numericSnippet = snippets.find(item => /\d/.test(item));
    if (numericSnippet) {
      return numericSnippet;
    }
  }

  if (POLITICAL_QUERY_PATTERN.test(normalizedQuery)) {
    const roleSnippet = snippets.find(item =>
      /\b(presidente|governador|ministro|prefeito|senador|deputado)\b/i.test(item),
    );
    if (roleSnippet) {
      return roleSnippet;
    }
  }

  return snippets[0];
}

function hasTemplatePlaceholder(text: string): boolean {
  return TEMPLATE_PLACEHOLDER_PATTERN.test(text);
}

function hasIncompleteEnding(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return true;
  }
  if (/[:;,\-]\s*$/.test(normalized)) {
    return true;
  }
  if (!/[.!?`)]$/.test(normalized)) {
    return normalized.length >= 24;
  }
  const tail = normalized.slice(Math.max(0, normalized.length - 28));
  return INCOMPLETE_ENDING_PATTERN.test(tail);
}

function isClearlyInvalidFragment(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return true;
  }
  if (FRAGMENT_ONLY_PATTERN.test(normalized)) {
    return true;
  }
  if (normalized.length <= 20 && /^(de acordo com|segundo|com base em)[\s.:;,\-]*$/i.test(normalized)) {
    return true;
  }
  return false;
}

function isTextUsableForFinalAnswer(text: string, hasValidatedSources: boolean): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  if (!hasValidatedSources && /^(de acordo com|segundo|com base em)\b/i.test(normalized)) {
    return false;
  }
  if (hasTemplatePlaceholder(normalized)) {
    return false;
  }
  if (isClearlyInvalidFragment(normalized)) {
    return false;
  }
  if (hasIncompleteEnding(normalized)) {
    return false;
  }
  return true;
}

export function buildFastWebAnswer(query: string, webResult?: WebSearchResult): string | null {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  if (CURRENT_YEAR_PATTERN.test(normalizedQuery)) {
    return `Estamos em ${new Date().getUTCFullYear()}.`;
  }

  if (CURRENT_DATE_PATTERN.test(normalizedQuery)) {
    const date = new Date();
    const ptBrDate = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return `Hoje e ${ptBrDate}.`;
  }

  if (!hasValidatedWebSources(webResult)) {
    return null;
  }

  const candidate = pickBestEvidenceSnippet(normalizedQuery, webResult);
  if (!candidate) {
    return null;
  }
  const sentence = firstMeaningfulSentence(candidate);
  return sentence || null;
}

export function buildPromptAugmentation(
  decision: SearchDecision,
  webResult?: WebSearchResult,
): PromptAugmentation {
  const hasValidatedWeb = hasValidatedWebSources(webResult);
  if (decision === 'local_plus_web' && hasValidatedWeb && webResult) {
    return {
      externalContext: buildWebEvidenceContext(webResult),
      policyInstruction:
        'Use os fatos do contexto validado para perguntas atuais. Nao afirme ter pesquisado; apenas entregue a resposta final objetiva.',
    };
  }

  if (decision === 'local_plus_web' && !hasValidatedWeb) {
    return {
      policyInstruction:
        'Nao invente fatos atuais. Se faltar confianca factual, informe de forma natural que nao foi possivel validar agora.',
    };
  }

  if (decision === 'local_with_uncertainty') {
    return {
      policyInstruction:
        'Se houver baixa confianca factual, responda com cautela e explicite incerteza sem inventar dados.',
    };
  }

  return {
    policyInstruction:
      'Nao diga que pesquisou na internet. Responda apenas com o conhecimento local quando for adequado.',
  };
}

export function composeAnswer({
  rawAnswer,
  decision,
  webResult,
}: AnswerCompositionInput): ComposedAnswer {
  const hasValidatedWeb = hasValidatedWebSources(webResult);
  const normalized = sanitizeWebHonesty(normalizeText(rawAnswer), decision, hasValidatedWeb);
  const normalizedSources = hasValidatedWeb ? normalizeSources(webResult?.sources) : [];
  const safeLocalAnswer = isTextUsableForFinalAnswer(normalized, hasValidatedWeb) ? normalized : '';

  if (decision !== 'local_plus_web') {
    const fallback = COMPOSITION_INTEGRITY_FALLBACK;
    return {
      text: safeLocalAnswer || fallback,
      sources: [],
      webValidationStatus: 'not_needed',
    };
  }

  if (hasValidatedWeb && webResult) {
    const fastWebAnswer = buildFastWebAnswer(webResult.query, webResult);
    const ensuredText =
      safeLocalAnswer ||
      (fastWebAnswer && isTextUsableForFinalAnswer(fastWebAnswer, true) ? fastWebAnswer : '') ||
      COMPOSITION_INTEGRITY_FALLBACK;
    return {
      text: ensuredText,
      sources: normalizedSources,
      webValidationStatus: 'validated',
    };
  }

  if (!safeLocalAnswer || safeLocalAnswer === HONEST_VALIDATION_FALLBACK) {
    return {
      text: HONEST_VALIDATION_FALLBACK,
      sources: [],
      webValidationStatus: 'failed',
    };
  }
  const textWithFallback = `${safeLocalAnswer}\n\n${WEB_VALIDATION_FALLBACK_NOTE}`;
  return {
    text: textWithFallback,
    sources: [],
    webValidationStatus: 'failed',
  };
}
