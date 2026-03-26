import {MessageSource} from '../types';

const DEFAULT_MAX_VISIBLE_SOURCES = 3;
const PLACEHOLDER_LABELS = new Set(['fonte', 'source', 'placeholder', 'site', 'link']);

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
  return title;
}

function normalizeUrl(rawUrl: string): string {
  const decoded = decodeBasicHtmlEntities(rawUrl).trim();
  if (!decoded) {
    return '';
  }
  const withProtocol =
    decoded.startsWith('http://') || decoded.startsWith('https://')
      ? decoded
      : `https://${decoded.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(withProtocol);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname ||
      !parsed.hostname.includes('.')
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function toSiteNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const clean = host.replace(/[:/]+$/g, '');
    return clean;
  } catch {
    return '';
  }
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const compact = normalized.replace(/[\s._-]+/g, '');
  if (!compact) {
    return true;
  }
  if (PLACEHOLDER_LABELS.has(normalized) || PLACEHOLDER_LABELS.has(compact)) {
    return true;
  }
  if (compact.includes('placeholder')) {
    return true;
  }
  return false;
}

export interface RawSourceCandidate {
  title: string;
  url: string;
}

export function buildSourceAttributions(
  candidates: RawSourceCandidate[],
  maxVisibleSources = DEFAULT_MAX_VISIBLE_SOURCES,
): MessageSource[] {
  const safeMaxVisibleSources =
    Number.isFinite(maxVisibleSources) && maxVisibleSources > 0
      ? Math.min(Math.floor(maxVisibleSources), DEFAULT_MAX_VISIBLE_SOURCES)
      : DEFAULT_MAX_VISIBLE_SOURCES;
  const uniqueByUrl = new Set<string>();
  const results: MessageSource[] = [];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    const dedupeKey = url.toLowerCase();
    if (!url || uniqueByUrl.has(dedupeKey)) {
      continue;
    }
    uniqueByUrl.add(dedupeKey);

    const siteName = toSiteNameFromUrl(url);
    if (!siteName || isPlaceholderValue(siteName)) {
      continue;
    }
    const normalizedTitle = normalizeTitle(candidate.title);
    const title =
      normalizedTitle && !isPlaceholderValue(normalizedTitle) ? normalizedTitle : siteName;
    if (!title || isPlaceholderValue(title)) {
      continue;
    }

    results.push({
      title,
      url,
      siteName,
    });

    if (results.length >= safeMaxVisibleSources) {
      break;
    }
  }

  return results;
}
