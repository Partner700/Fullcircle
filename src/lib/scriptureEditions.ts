export const SCRIPTURE_EDITIONS = [
  { value: 'published', label: 'Published edition', language: undefined },
  { value: 'web', label: 'English · World English Bible', language: 'en' },
  { value: 'kjv', label: 'English · King James Version', language: 'en' },
  { value: 'lsg', label: 'Français · Louis Segond', language: 'fr' },
  { value: 'rvr1909', label: 'Español · Reina-Valera 1909', language: 'es' },
  { value: 'alm1911', label: 'Português · Almeida 1911', language: 'pt' },
  { value: 'luth1912', label: 'Deutsch · Lutherbibel 1912', language: 'de' },
] as const;

export function readScriptureEdition(userId?: string, language?: string | null) {
  try {
    const stored = globalThis.localStorage?.getItem(`fc-scripture-edition:${userId ?? 'guest'}`);
    if (stored && SCRIPTURE_EDITIONS.some((edition) => edition.value === stored)) return stored;
  } catch {
    // Reading remains available when storage is blocked.
  }
  return language?.toLowerCase().split('-')[0] === 'fr' ? 'lsg' : 'published';
}

export function saveScriptureEdition(value: string, userId?: string) {
  try {
    globalThis.localStorage?.setItem(`fc-scripture-edition:${userId ?? 'guest'}`, value);
  } catch {
    // The selection still applies to the open reader.
  }
}

export async function fetchEditionVerses(
  edition: string,
  references: string[],
  signal: AbortSignal,
  request = fetch,
) {
  const chapters = new Map<string, Map<string, number>>();
  for (const reference of references) {
    const match = reference.trim().match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!match) continue;
    const book = match[1].toLowerCase().replace(/\s+/g, '-');
    const key = `${encodeURIComponent(book)}/${match[2]}`;
    const verses = chapters.get(key) ?? new Map<string, number>();
    verses.set(reference, Number(match[3]));
    chapters.set(key, verses);
  }

  const translations = new Map<string, string>();
  const credits = new Set<string>();
  await Promise.allSettled([...chapters].map(async ([chapter, referencesInChapter]) => {
    const numbers = [...referencesInChapter.values()];
    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    const range = first === last ? first : `${first}-${last}`;
    const response = await request(`https://api.midvash.com/v1/${edition}/${chapter}/${range}`, { signal });
    if (!response.ok) return;
    const { data, meta } = await response.json();
    if (data?.version !== edition || data.verse !== first || !Array.isArray(data.verses)) return;
    for (const [reference, verse] of referencesInChapter) {
      const text = data.verses[verse - first];
      if (typeof text === 'string' && text.trim()) translations.set(reference, text.trim());
    }
    if (typeof meta?.copyright === 'string' && meta.copyright.trim()) credits.add(meta.copyright.trim());
  }));
  return { translations, credit: [...credits].join(' · ') };
}
