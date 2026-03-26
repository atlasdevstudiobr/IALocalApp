import {MessageSource} from '../types';
import {buildSourceAttributions, RawSourceCandidate} from './sourceAttribution';
import {logError, logInfo, logWarn} from './logService';

const TAG = 'WebSearchService';
const BING_RSS_ENDPOINT = 'https://www.bing.com/search?format=rss&q=';
const DEFAULT_TIMEOUT_MS = 4800;
const MAX_ITEMS_TO_PARSE = 6;
const MAX_EVIDENCE_LINES = 4;

export interface WebSearchEvidence {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface WebSearchResult {
  ok: boolean;
  query: string;
  fetchedAtIso: string;
  evidences: WebSearchEvidence[];
  sources: MessageSource[];
  errorMessage?: string;
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
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(itemXml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = itemXml.match(regex);
  return match?.[1] ? decodeXmlEntities(match[1]) : '';
}

function truncateSnippet(snippet: string, limit = 220): string {
  if (snippet.length <= limit) {
    return snippet;
  }
  return `${snippet.slice(0, limit - 3).trim()}...`;
}

function parseRssItems(xml: string): WebSearchEvidence[] {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const evidences: WebSearchEvidence[] = [];

  for (const itemXml of matches) {
    if (evidences.length >= MAX_ITEMS_TO_PARSE) {
      break;
    }

    const title = extractTag(itemXml, 'title');
    const url = extractTag(itemXml, 'link');
    const snippet = truncateSnippet(extractTag(itemXml, 'description'));
    const publishedAt = extractTag(itemXml, 'pubDate');
    if (!title || !url || !snippet) {
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
  return evidences.slice(0, MAX_EVIDENCE_LINES);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller !== null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, text/plain',
      },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`status_${response.status}`);
    }
    return await response.text();
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function searchWeb(query: string): Promise<WebSearchResult> {
  const normalizedQuery = normalizeQuery(query);
  const fetchedAtIso = new Date().toISOString();
  if (!normalizedQuery) {
    return {
      ok: false,
      query: normalizedQuery,
      fetchedAtIso,
      evidences: [],
      sources: [],
      errorMessage: 'consulta_vazia',
    };
  }

  const requestUrl = `${BING_RSS_ENDPOINT}${encodeURIComponent(normalizedQuery)}`;
  logInfo(TAG, 'Busca web iniciada', `query=${normalizedQuery}`);

  try {
    const xml = await fetchWithTimeout(requestUrl, DEFAULT_TIMEOUT_MS);
    const evidences = buildEvidenceLines(parseRssItems(xml));
    if (evidences.length === 0) {
      logWarn(TAG, 'Busca web sem itens parseaveis', `query=${normalizedQuery}`);
      return {
        ok: false,
        query: normalizedQuery,
        fetchedAtIso,
        evidences: [],
        sources: [],
        errorMessage: 'sem_resultados',
      };
    }

    const rawCandidates: RawSourceCandidate[] = evidences.map(item => ({
      title: item.title,
      url: item.url,
    }));
    const sources = buildSourceAttributions(rawCandidates);
    logInfo(
      TAG,
      'Busca web concluida',
      `query=${normalizedQuery}\nevidences=${evidences.length}\nsources=${sources.length}`,
    );
    return {
      ok: true,
      query: normalizedQuery,
      fetchedAtIso,
      evidences,
      sources,
    };
  } catch (error) {
    const details = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    logError(TAG, 'Busca web falhou', `query=${normalizedQuery}\n${details}`);
    return {
      ok: false,
      query: normalizedQuery,
      fetchedAtIso,
      evidences: [],
      sources: [],
      errorMessage: 'falha_busca',
    };
  }
}
