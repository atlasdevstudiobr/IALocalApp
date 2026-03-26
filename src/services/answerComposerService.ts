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

function normalizeText(text: string): string {
  return text.replace(/\s+$/g, '').trim();
}

function sanitizeWebHonesty(
  text: string,
  decision: SearchDecision,
  webResult?: WebSearchResult,
): string {
  if (!text) {
    return '';
  }
  if (decision === 'local_plus_web' && webResult?.ok) {
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

export function buildPromptAugmentation(
  decision: SearchDecision,
  webResult?: WebSearchResult,
): PromptAugmentation {
  if (decision === 'local_plus_web' && webResult?.ok) {
    return {
      externalContext: buildWebEvidenceContext(webResult),
      policyInstruction:
        'Use os fatos do contexto validado para perguntas atuais. Nao afirme ter pesquisado; apenas entregue a resposta final objetiva.',
    };
  }

  if (decision === 'local_plus_web' && !webResult?.ok) {
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
  const normalized = sanitizeWebHonesty(normalizeText(rawAnswer), decision, webResult);

  if (decision !== 'local_plus_web') {
    return {
      text: normalized,
      sources: [],
      webValidationStatus: 'not_needed',
    };
  }

  if (webResult?.ok) {
    return {
      text: normalized,
      sources: webResult.sources,
      webValidationStatus: 'validated',
    };
  }

  const fallbackNote =
    'Nao consegui validar na internet agora. Posso tentar novamente em seguida.';
  const textWithFallback = normalized
    ? `${normalized}\n\n${fallbackNote}`
    : fallbackNote;
  return {
    text: textWithFallback,
    sources: [],
    webValidationStatus: 'failed',
  };
}
