const SCRIPTURE_TARGET_KEY = 'full-circle-scripture-target';

export type ScriptureNavigationTarget = {
  narrativeId?: string;
  verseReference?: string;
  insightId?: string;
};

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function scriptureTargetFromMetadata(metadata: Record<string, unknown> | null | undefined): ScriptureNavigationTarget | null {
  const target = {
    narrativeId: clean(metadata?.narrative_id),
    verseReference: clean(metadata?.verse_reference),
    insightId: clean(metadata?.insight_id),
  };
  return target.narrativeId || target.verseReference || target.insightId ? target : null;
}

export function scriptureTargetUrl(actionKey: string | null | undefined, metadata?: Record<string, unknown> | null) {
  const params = new URLSearchParams();
  if (actionKey) params.set('fc-tab', actionKey);
  const target = scriptureTargetFromMetadata(metadata);
  if (target?.narrativeId) params.set('fc-narrative', target.narrativeId);
  if (target?.verseReference) params.set('fc-verse', target.verseReference);
  if (target?.insightId) params.set('fc-insight', target.insightId);
  return params.size ? `/#${params.toString()}` : '/';
}

export function storeScriptureTarget(target: ScriptureNavigationTarget | null) {
  if (typeof window === 'undefined' || !target) return;
  window.sessionStorage.setItem(SCRIPTURE_TARGET_KEY, JSON.stringify(target));
  window.dispatchEvent(new CustomEvent<ScriptureNavigationTarget>('full-circle-open-scripture', { detail: target }));
}

export function readScriptureTarget(): ScriptureNavigationTarget | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashTarget: ScriptureNavigationTarget = {
    narrativeId: clean(hash.get('fc-narrative')),
    verseReference: clean(hash.get('fc-verse')),
    insightId: clean(hash.get('fc-insight')),
  };
  if (hashTarget.narrativeId || hashTarget.verseReference || hashTarget.insightId) return hashTarget;
  try {
    return scriptureTargetFromMetadata(JSON.parse(window.sessionStorage.getItem(SCRIPTURE_TARGET_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function clearScriptureTarget() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SCRIPTURE_TARGET_KEY);
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.delete('fc-narrative');
  params.delete('fc-verse');
  params.delete('fc-insight');
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${params.size ? `#${params.toString()}` : ''}`);
}
