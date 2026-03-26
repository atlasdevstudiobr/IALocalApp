import {MessageSource} from '../types';

const MAX_VISIBLE_SOURCES = 3;

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTitle(rawTitle: string): string {
  const title = decodeBasicHtmlEntities(rawTitle).replace(/\s+/g, ' ').trim();
  if (!title) {
    return 'Fonte';
  }
  return title;
}

function normalizeUrl(rawUrl: string): string {
  const decoded = decodeBasicHtmlEntities(rawUrl).trim();
  if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
    return decoded;
  }
  return `https://${decoded.replace(/^\/+/, '')}`;
}

function toSiteNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const clean = host.replace(/[:/]+$/g, '');
    return clean || 'fonte';
  } catch {
    return 'fonte';
  }
}

export interface RawSourceCandidate {
  title: string;
  url: string;
}

export function buildSourceAttributions(candidates: RawSourceCandidate[]): MessageSource[] {
  const uniqueByUrl = new Set<string>();
  const results: MessageSource[] = [];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    if (!url || uniqueByUrl.has(url)) {
      continue;
    }
    uniqueByUrl.add(url);

    results.push({
      title: normalizeTitle(candidate.title),
      url,
      siteName: toSiteNameFromUrl(url),
    });

    if (results.length >= MAX_VISIBLE_SOURCES) {
      break;
    }
  }

  return results;
}
