import {Message, SearchDecision} from '../types';

export interface SearchDecisionResult {
  decision: SearchDecision;
  query: string;
  reason: string;
}

const STRONG_WEB_PATTERNS: RegExp[] = [
  /\b(hoje|agora|atual|atualmente|neste ano|esse ano|ano atual)\b/i,
  /\b(ultim[oa]s?|recentes?|recente|not[i\u00ED]cia|not[i\u00ED]cias|manchete)\b/i,
  /\b(clima|temperatura|chuva|previs[a\u00E3]o do tempo)\b/i,
  /\b(cota[c\u00E7][a\u00E3]o|pre[c\u00E7]o|d[o\u00F3]lar|bitcoin|btc|euro|ibovespa|selic)\b/i,
  /\b(presidente|governador|ministro|prefeito|senador|deputado|cargo atual)\b/i,
  /\b(capital da|capital do)\b/i,
  /\b(lei|regra|regulamento|norma|decreto|portaria)\b/i,
  /\b(data de hoje|que dia e hoje|que ano estamos|ano atual)\b/i,
];
const FAST_FACT_PATTERNS: RegExp[] = [
  /\b(que ano estamos|ano atual|em que ano estamos|data de hoje|qual a data de hoje|que dia e hoje)\b/i,
  /\b(quem [e\u00E9] o (?:atual )?(?:presidente|governador|prefeito|ministro|senador|deputado)|(?:atual\s+)?(?:presidente|governador|prefeito|ministro|senador|deputado)\s+(?:do|da|de)|presidente do brasil|cargo politico atual)\b/i,
  /\b(quanto est[a\u00E1] o d[o\u00F3]lar|cota[c\u00E7][a\u00E3]o do d[o\u00F3]lar|d[o\u00F3]lar hoje|euro hoje|bitcoin hoje|btc hoje)\b/i,
  /\b(clima|temperatura|previs[a\u00E3]o do tempo|tempo em)\b/i,
  /\b(capital da|capital do)\b/i,
];

const FACTUAL_QUESTION_START =
  /^(quem|qual|quais|quando|onde|quanto|quantos|quantas|que|como)\b/i;
const STABLE_HISTORY_HINT =
  /\b(hist[o\u00F3]ria|historicamente|em\s+\d{3,4}|s[e\u00E9]culo|idade m[e\u00E9]dia|imp[e\u00E9]rio|imp[e\u00E9]rio romano)\b/i;

function getLastUserMessage(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && typeof message.content === 'string') {
      return message.content.trim();
    }
  }
  return '';
}

export function isFastWebFactQuery(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 120 || normalized.includes('\n')) {
    return false;
  }
  return FAST_FACT_PATTERNS.some(pattern => pattern.test(normalized));
}

export function classifySearchDecision(messages: Message[]): SearchDecisionResult {
  const query = getLastUserMessage(messages);
  if (!query) {
    return {
      decision: 'local_only',
      query: '',
      reason: 'sem_pergunta',
    };
  }

  const normalized = query.toLowerCase();
  if (STRONG_WEB_PATTERNS.some(pattern => pattern.test(normalized))) {
    return {
      decision: 'local_plus_web',
      query,
      reason: 'sinal_temporal_ou_factual_mutavel',
    };
  }

  const looksFactualQuestion =
    FACTUAL_QUESTION_START.test(normalized) &&
    query.length <= 160 &&
    !query.includes('\n') &&
    !STABLE_HISTORY_HINT.test(normalized);

  if (looksFactualQuestion) {
    return {
      decision: 'local_with_uncertainty',
      query,
      reason: 'pergunta_factual_sem_validacao_explicita',
    };
  }

  return {
    decision: 'local_only',
    query,
    reason: 'conteudo_estavel_ou_conversacional',
  };
}
