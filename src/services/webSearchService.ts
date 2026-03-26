import {MessageSource} from '../types';
import {buildSourceAttributions, RawSourceCandidate} from './sourceAttribution';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'WebSearchService';
const BING_RSS_ENDPOINT = 'https://www.bing.com/search?format=rss&q=';
const GOOGLE_SEARCH_ENDPOINT = 'https://www.google.com/search?hl=pt-BR&gl=BR&num=6&q=';
const STANDARD_TIMEOUT_MS = 4200;
const FAST_TIMEOUT_MS = 1900;
const GOOGLE_STANDARD_TIMEOUT_MS = 2000;
const GOOGLE_FAST_TIMEOUT_MS = 1300;
const STANDARD_MAX_ITEMS_TO_PARSE = 6;
const FAST_MAX_ITEMS_TO_PARSE = 3;
const STANDARD_MAX_EVIDENCE_LINES = 4;
const FAST_MAX_EVIDENCE_LINES = 2;
const STANDARD_SNIPPET_LIMIT = 220;
const FAST_SNIPPET_LIMIT = 170;
const STANDARD_GOOGLE_MAX_EVIDENCE_LINES = 3;
const FAST_GOOGLE_MAX_EVIDENCE_LINES = 2;
const STANDARD_MAX_SOURCES = 3;
const FAST_MAX_SOURCES = 2;
const STANDARD_TOTAL_BUDGET_MS = 4600;
const FAST_TOTAL_BUDGET_MS = 2500;
const MIN_FALLBACK_BUDGET_MS = 420;
const BUDGET_GUARD_MS = 120;
const SUCCESS_CACHE_TTL_MS = 2 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 22 * 1000;

interface CachedWebResult {
  expiresAt: number;
  result: WebSearchResult;
}

const RESULT_CACHE = new Map<string, CachedWebResult>();
const IN_FLIGHT_SEARCHES = new Map<string, Promise<WebSearchResult>>();

export type WebSearchMode = 'standard' | 'fast';

export interface WebSearchOptions {
  mode?: WebSearchMode;
  timeoutMs?: number;
}

export interface WebSearchEvidence {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface WebSearchResult {
  ok: boolean;
  query: string;
  mode: WebSearchMode;
  fetchedAtIso: string;
  durationMs: number;
  evidences: WebSearchEvidence[];
  sources: MessageSource[];
  errorMessage?: string;
  timedOut?: boolean;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return decodeXmlEntities(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const parsed = Number(decimal);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    })
    .replace(/&#x([a-f0-9]+);/gi, (_match, hex: string) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(itemXml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = itemXml.match(regex);
  return match?.[1] ? decodeXmlEntities(match[1]) : '';
}

function truncateSnippet(snippet: string, limit: number): string {
  if (snippet.length <= limit) {
    return snippet;
  }
  return `${snippet.slice(0, limit - 3).trim()}...`;
}

function parseRssItems(xml: string, maxItemsToParse: number, snippetLimit: number): WebSearchEvidence[] {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const evidences: WebSearchEvidence[] = [];

  for (const itemXml of matches) {
    if (evidences.length >= maxItemsToParse) {
      break;
    }

    const title = extractTag(itemXml, 'title');
    const url = extractTag(itemXml, 'link');
    const description = extractTag(itemXml, 'description');
    const snippet = truncateSnippet(description || title, snippetLimit);
    const publishedAt = extractTag(itemXml, 'pubDate');
    if (!title || !url) {
      continue;
    }

    evidences.push({
      title,
      url,
      snippet,
      publishedAt: publishedAt || undefined,
    });
  }

  return evidences;
}

function buildEvidenceLines(evidences: WebSearchEvidence[]): WebSearchEvidence[] {
  return evidences;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const resolveSafely = (value: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      resolve(value);
    };

    const rejectSafely = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      reject(error);
    };

    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch (_error) {
        // Abort best-effort: nao interrompe fallback.
      }
      rejectSafely(new Error('timeout'));
    }, timeoutMs);

    void fetch(url, {
      method: 'GET',
      headers: {
        Accept:
          'application/rss+xml, application/xml, text/xml, text/plain, text/html;q=0.9',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      signal: controller?.signal,
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`status_${response.status}`);
        }
        return response.text();
      })
      .then(text => {
        resolveSafely(text);
      })
      .catch(error => {
        rejectSafely(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function getCacheKey(normalizedQuery: string, mode: WebSearchMode): string {
  return `${mode}::${normalizedQuery.toLowerCase()}`;
}

function cloneResult(result: WebSearchResult): WebSearchResult {
  return {
    ...result,
    evidences: result.evidences.map(item => ({...item})),
    sources: result.sources.map(item => ({...item})),
  };
}

function readResultCache(cacheKey: string): WebSearchResult | null {
  const cached = RESULT_CACHE.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    RESULT_CACHE.delete(cacheKey);
    return null;
  }
  return cloneResult(cached.result);
}

function writeResultCache(cacheKey: string, result: WebSearchResult): void {
  const ttlMs = result.ok ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
  RESULT_CACHE.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    result: cloneResult(result),
  });
}

function getTotalBudgetMs(mode: WebSearchMode): number {
  return mode === 'fast' ? FAST_TOTAL_BUDGET_MS : STANDARD_TOTAL_BUDGET_MS;
}

function getRemainingBudgetMs(startedAt: number, totalBudgetMs: number): number {
  return totalBudgetMs - (Date.now() - startedAt);
}

function resolveFallbackTimeoutMs(mode: WebSearchMode, remainingBudgetMs: number): number | null {
  if (remainingBudgetMs < MIN_FALLBACK_BUDGET_MS) {
    return null;
  }
  const configured = mode === 'fast' ? GOOGLE_FAST_TIMEOUT_MS : GOOGLE_STANDARD_TIMEOUT_MS;
  const capped = Math.min(configured, Math.max(0, Math.floor(remainingBudgetMs - BUDGET_GUARD_MS)));
  if (capped < MIN_FALLBACK_BUDGET_MS) {
    return null;
  }
  return capped;
}

function normalizeGoogleResultUrl(rawHref: string): string {
  const decodedHref = decodeHtmlEntities(rawHref).trim();
  if (!decodedHref) {
    return '';
  }
  if (/^https?:\/\//i.test(decodedHref)) {
    return decodedHref;
  }
  if (decodedHref.startsWith('/url?')) {
    const queryPart = decodedHref.split('?')[1] ?? '';
    const params = new URLSearchParams(queryPart);
    const candidate = params.get('q') ?? '';
    if (!candidate) {
      return '';
    }
    const decodedCandidate = decodeHtmlEntities(candidate).trim();
    return /^https?:\/\//i.test(decodedCandidate) ? decodedCandidate : '';
  }
  return '';
}

function extractGoogleAnswerCandidate(html: string): string {
  const patterns: RegExp[] = [
    /<div[^>]+class="[^"]*IZ6rdc[^"]*"[^>]*>([\s\S]{1,700}?)<\/div>/i,
    /<div[^>]+class="[^"]*yXK7lf[^"]*"[^>]*>([\s\S]{1,700}?)<\/div>/i,
    /<span[^>]+class="[^"]*hgKElc[^"]*"[^>]*>([\s\S]{1,700}?)<\/span>/i,
    /<div[^>]+class="[^"]*kno-rdesc[^"]*"[^>]*>([\s\S]{1,900}?)<\/div>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const clean = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (clean && clean.length >= 12) {
      return clean;
    }
  }
  return '';
}

function parseGoogleHtmlItems(
  html: string,
  maxItemsToParse: number,
  maxEvidenceLines: number,
  snippetLimit: number,
): WebSearchEvidence[] {
  const evidences: WebSearchEvidence[] = [];
  const uniqueByUrl = new Set<string>();
  const answerCandidate = extractGoogleAnswerCandidate(html);
  const resultPattern =
    /<a[^>]+href="([^"]+)"[^>]*>\s*(?:<div[^>]*>\s*)?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,1400}?(?:<div[^>]+class="[^"]*(?:VwiC3b|s3v9rd|MUxGbd|yXK7lf|lyLwlc)[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;

  let match: RegExpExecArray | null;
  while (true) {
    match = resultPattern.exec(html);
    if (!match) {
      break;
    }
    if (evidences.length >= maxItemsToParse) {
      break;
    }

    const url = normalizeGoogleResultUrl(match[1] ?? '');
    if (!url || uniqueByUrl.has(url.toLowerCase())) {
      continue;
    }

    const title = decodeHtmlEntities(match[2] ?? '');
    const snippetRaw = decodeHtmlEntities(match[3] ?? '') || answerCandidate || title;
    const snippet = truncateSnippet(snippetRaw, snippetLimit);
    if (!title || !snippet) {
      continue;
    }

    uniqueByUrl.add(url.toLowerCase());
    evidences.push({
      title,
      url,
      snippet,
    });
  }

  return evidences.slice(0, maxEvidenceLines);
}

async function searchGoogleFallback(
  normalizedQuery: string,
  mode: WebSearchMode,
  snippetLimit: number,
  timeoutMsOverride?: number,
): Promise<WebSearchEvidence[]> {
  const configuredTimeoutMs = mode === 'fast' ? GOOGLE_FAST_TIMEOUT_MS : GOOGLE_STANDARD_TIMEOUT_MS;
  const timeoutMs =
    typeof timeoutMsOverride === 'number' && Number.isFinite(timeoutMsOverride) && timeoutMsOverride > 0
      ? Math.max(MIN_FALLBACK_BUDGET_MS, Math.floor(timeoutMsOverride))
      : configuredTimeoutMs;
  const maxItemsToParse = mode === 'fast' ? FAST_MAX_ITEMS_TO_PARSE : STANDARD_MAX_ITEMS_TO_PARSE;
  const maxEvidenceLines =
    mode === 'fast' ? FAST_GOOGLE_MAX_EVIDENCE_LINES : STANDARD_GOOGLE_MAX_EVIDENCE_LINES;
  const requestUrl = `${GOOGLE_SEARCH_ENDPOINT}${encodeURIComponent(normalizedQuery)}`;
  try {
    const html = await fetchWithTimeout(requestUrl, timeoutMs);
    const evidences = parseGoogleHtmlItems(html, maxItemsToParse, maxEvidenceLines, snippetLimit);
    if (evidences.length > 0) {
      logInfo(
        TAG,
        'Fallback Google aplicado com sucesso',
        `query=${normalizedQuery}\nmode=${mode}\nevidences=${evidences.length}`,
      );
    } else {
      logWarn(TAG, 'Fallback Google sem evidencias parseaveis', `query=${normalizedQuery}`);
    }
    return evidences;
  } catch (error) {
    const details = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    logWarn(TAG, 'Fallback Google falhou', `query=${normalizedQuery}\n${details}`);
    return [];
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes('timeout') || error.name === 'AbortError';
}

async function searchWebInternal(
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult> {
  const mode: WebSearchMode = options.mode === 'fast' ? 'fast' : 'standard';
  const totalBudgetMs = getTotalBudgetMs(mode);
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.max(900, Math.min(Math.floor(options.timeoutMs), 10000))
      : mode === 'fast'
      ? FAST_TIMEOUT_MS
      : STANDARD_TIMEOUT_MS;
  const safePrimaryTimeoutMs = Math.min(timeoutMs, totalBudgetMs);
  const maxItemsToParse = mode === 'fast' ? FAST_MAX_ITEMS_TO_PARSE : STANDARD_MAX_ITEMS_TO_PARSE;
  const maxEvidenceLines =
    mode === 'fast' ? FAST_MAX_EVIDENCE_LINES : STANDARD_MAX_EVIDENCE_LINES;
  const snippetLimit = mode === 'fast' ? FAST_SNIPPET_LIMIT : STANDARD_SNIPPET_LIMIT;
  const maxSources = mode === 'fast' ? FAST_MAX_SOURCES : STANDARD_MAX_SOURCES;
  const normalizedQuery = normalizeQuery(query);
  const fetchedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  if (!normalizedQuery) {
    return {
      ok: false,
      query: normalizedQuery,
      mode,
      fetchedAtIso,
      durationMs: Date.now() - startedAt,
      evidences: [],
      sources: [],
      errorMessage: 'consulta_vazia',
    };
  }

  const requestUrl = `${BING_RSS_ENDPOINT}${encodeURIComponent(normalizedQuery)}`;
  logInfo(TAG, 'Busca web iniciada', `query=${normalizedQuery}\nmode=${mode}\ntimeoutMs=${timeoutMs}`);

  try {
    const xml = await fetchWithTimeout(requestUrl, safePrimaryTimeoutMs);
    let evidences = buildEvidenceLines(
      parseRssItems(xml, maxItemsToParse, snippetLimit),
    ).slice(0, maxEvidenceLines);
    if (evidences.length === 0) {
      const remainingBudgetMs = getRemainingBudgetMs(startedAt, totalBudgetMs);
      const fallbackTimeoutMs = resolveFallbackTimeoutMs(mode, remainingBudgetMs);
      if (fallbackTimeoutMs !== null) {
        evidences = await searchGoogleFallback(
          normalizedQuery,
          mode,
          snippetLimit,
          fallbackTimeoutMs,
        );
      } else {
        logWarn(
          TAG,
          'Fallback Google ignorado por baixo orcamento de tempo',
          `query=${normalizedQuery}\nremainingMs=${remainingBudgetMs}`,
        );
      }
    }
    if (evidences.length === 0) {
      logWarn(TAG, 'Busca web sem itens parseaveis', `query=${normalizedQuery}`);
      return {
        ok: false,
        query: normalizedQuery,
        mode,
        fetchedAtIso,
        durationMs: Date.now() - startedAt,
        evidences: [],
        sources: [],
        errorMessage: 'sem_resultados',
      };
    }

    const rawCandidates: RawSourceCandidate[] = evidences.map(item => ({
      title: item.title,
      url: item.url,
    }));
    const sources = buildSourceAttributions(rawCandidates, maxSources);
    logInfo(
      TAG,
      'Busca web concluida',
      `query=${normalizedQuery}\nmode=${mode}\nevidences=${evidences.length}\nsources=${sources.length}\ndurationMs=${
        Date.now() - startedAt
      }`,
    );
    return {
      ok: true,
      query: normalizedQuery,
      mode,
      fetchedAtIso,
      durationMs: Date.now() - startedAt,
      evidences,
      sources,
    };
  } catch (error) {
    const details = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    logError(TAG, 'Busca web falhou', `query=${normalizedQuery}\n${details}`);
    const timedOut = isTimeoutError(error);
    let googleFallbackEvidences: WebSearchEvidence[] = [];
    const remainingBudgetMs = getRemainingBudgetMs(startedAt, totalBudgetMs);
    const fallbackTimeoutMs = resolveFallbackTimeoutMs(mode, remainingBudgetMs);
    if (fallbackTimeoutMs !== null) {
      googleFallbackEvidences = await searchGoogleFallback(
        normalizedQuery,
        mode,
        snippetLimit,
        fallbackTimeoutMs,
      );
    } else {
      logWarn(
        TAG,
        'Fallback Google ignorado apos falha por baixo orcamento de tempo',
        `query=${normalizedQuery}\nremainingMs=${remainingBudgetMs}`,
      );
    }
    if (googleFallbackEvidences.length > 0) {
      const rawCandidates: RawSourceCandidate[] = googleFallbackEvidences.map(item => ({
        title: item.title,
        url: item.url,
      }));
      const sources = buildSourceAttributions(rawCandidates, maxSources);
      return {
        ok: true,
        query: normalizedQuery,
        mode,
        fetchedAtIso,
        durationMs: Date.now() - startedAt,
        evidences: googleFallbackEvidences,
        sources,
      };
    }
    return {
      ok: false,
      query: normalizedQuery,
      mode,
      fetchedAtIso,
      durationMs: Date.now() - startedAt,
      evidences: [],
      sources: [],
      errorMessage: timedOut ? 'timeout' : 'falha_busca',
      timedOut,
    };
  }
}

export async function searchWeb(
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult> {
  const mode: WebSearchMode = options.mode === 'fast' ? 'fast' : 'standard';
  const normalizedQuery = normalizeQuery(query);
  const cacheKey = getCacheKey(normalizedQuery, mode);
  const cachedResult = readResultCache(cacheKey);
  if (cachedResult) {
    logInfo(TAG, 'Busca web servida por cache', `query=${normalizedQuery}\nmode=${mode}`);
    return cachedResult;
  }

  if (!normalizedQuery) {
    const emptyResult = await searchWebInternal(query, options);
    writeResultCache(cacheKey, emptyResult);
    return emptyResult;
  }

  const inFlight = IN_FLIGHT_SEARCHES.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = searchWebInternal(query, options)
    .then(result => {
      writeResultCache(cacheKey, result);
      return result;
    })
    .finally(() => {
      IN_FLIGHT_SEARCHES.delete(cacheKey);
    });

  IN_FLIGHT_SEARCHES.set(cacheKey, pending);
  return pending;
}
