const SOUND_ENABLED_KEY = 'full-circle-sound-enabled';
import { supabase } from './supabase';

export type SoundMood = 'home' | 'instructor_overview' | 'sentry_overview' | 'reading' | 'tent' | 'game' | 'quiz' | 'board' | 'awards' | 'market' | 'default';

let audioContext: AudioContext | null = null;
let currentMood: SoundMood = 'default';
let dashboardAudio: HTMLAudioElement | null = null;
let scenarioAudio: HTMLAudioElement | null = null;
const dashboardLoops = new Set<HTMLAudioElement>();
const scenarioLoops = new Set<HTMLAudioElement>();
let soundSyncVersion = 0;
let scenarioSyncVersion = 0;
type SoundAsset = { url: string; start: number; end: number | null };
const assetCache = new Map<string, SoundAsset | null>();
let soundAudience: string | null = null;
const DASHBOARD_VOLUME = 0.22;
const DASHBOARD_FADE_MS = 850;
const SOUND_STATE_EVENT = 'full-circle-sound-state';

const moodSoundSlots: Partial<Record<SoundMood, string>> = {
  instructor_overview: 'sound_instructor_overview',
  sentry_overview: 'sound_sentry_overview',
  reading: 'sound_reading',
  tent: 'sound_tent',
  game: 'sound_game_lobby',
  quiz: 'sound_quiz_waiting',
  board: 'sound_board',
  awards: 'sound_award',
  market: 'sound_market',
  default: 'sound_welcome',
};

/** Call after an instructor changes a shared sound so the next interaction
 * uses the new upload without requiring a browser refresh. */
export function invalidateSoundAsset(type?: string) {
  if (type) assetCache.delete(type);
  else assetCache.clear();
}

/** Keep role-scoped uploads correct when a shared device changes accounts. */
export function setSoundscapeAudience(audience: 'cadets' | 'sentries' | 'instructors') {
  if (soundAudience === audience) return;
  soundAudience = audience;
  assetCache.clear();
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

export function isSoundscapeEnabled() {
  return typeof window !== 'undefined' && localStorage.getItem(SOUND_ENABLED_KEY) === 'true';
}

export function isSoundscapePlaying() {
  return Boolean(
    isSoundscapeEnabled()
    && ((dashboardAudio && !dashboardAudio.paused) || (scenarioAudio && !scenarioAudio.paused)),
  );
}

function emitSoundState() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SOUND_STATE_EVENT, {
    detail: { enabled: isSoundscapeEnabled(), playing: isSoundscapePlaying() },
  }));
}

export function subscribeToSoundscape(listener: (state: { enabled: boolean; playing: boolean }) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => listener((event as CustomEvent<{ enabled: boolean; playing: boolean }>).detail);
  window.addEventListener(SOUND_STATE_EVENT, handle);
  listener({ enabled: isSoundscapeEnabled(), playing: isSoundscapePlaying() });
  return () => window.removeEventListener(SOUND_STATE_EVENT, handle);
}

async function getSoundAsset(type: string): Promise<SoundAsset | null> {
  const cacheKey = type;
  if (assetCache.has(cacheKey)) return assetCache.get(cacheKey) || null;
  try {
    if (!soundAudience) {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: roles } = await supabase
          .from('role_assignments')
          .select('role')
          .eq('user_id', userData.user.id)
          .in('status', ['active', 'approved']);
        soundAudience = roles?.some((role) => role.role === 'instructor')
          ? 'instructors'
          : roles?.some((role) => role.role === 'sentry')
            ? 'sentries'
            : 'cadets';
      } else {
        soundAudience = 'all';
      }
    }
    const { data, error } = await supabase
      .from('scheduled_announcements')
      .select('content, audience, audio_start_seconds, audio_end_seconds')
      .eq('announcement_type', type)
      .eq('is_active', true)
      .lte('publish_at', new Date().toISOString())
      .in('audience', ['all', soundAudience])
      .order('publish_at', { ascending: false })
      .limit(8);
    if (error) throw error;
    const preferred = data?.find((item) => item.audience === soundAudience) || data?.[0];
    const url = preferred?.content?.trim();
    const asset = url ? {
      url,
      start: Math.max(0, Number(preferred?.audio_start_seconds) || 0),
      end: preferred?.audio_end_seconds == null ? null : Math.max(0, Number(preferred.audio_end_seconds) || 0),
    } : null;
    assetCache.set(cacheKey, asset);
    return asset;
  } catch {
    return null;
  }
}

async function getSoundUrl(type: string) {
  return (await getSoundAsset(type))?.url || null;
}

function applySoundCrop(audio: HTMLAudioElement, asset: SoundAsset, repeat = true) {
  if (asset.start <= 0 && !asset.end) return;
  const seekToStart = () => { if (asset.start > 0) audio.currentTime = asset.start; };
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) seekToStart();
  else audio.addEventListener('loadedmetadata', seekToStart, { once: true });
  audio.addEventListener('timeupdate', () => {
    if (!asset.end || audio.currentTime < asset.end) return;
    if (repeat) audio.currentTime = asset.start;
    else {
      audio.pause();
      audio.currentTime = asset.start;
    }
  });
}

function observeLoopState(audio: HTMLAudioElement) {
  const report = () => emitSoundState();
  audio.addEventListener('play', report);
  audio.addEventListener('pause', report);
  audio.addEventListener('ended', report);
}

function fadeVolume(audio: HTMLAudioElement, target: number, duration = DASHBOARD_FADE_MS) {
  const start = audio.volume;
  const startedAt = performance.now();
  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // Browser animation timestamps can arrive slightly out of order during
      // a busy render. Clamp the interpolated value to HTMLMediaElement's
      // required 0..1 range before assigning it.
      audio.volume = Math.max(0, Math.min(1, start + ((target - start) * progress)));
      if (progress < 1) window.requestAnimationFrame(step);
      else resolve();
    };
    window.requestAnimationFrame(step);
  });
}

async function stopDashboardSound(fadeMs = 0) {
  dashboardAudio = null;
  const loops = [...dashboardLoops];
  if (fadeMs > 0) {
    await Promise.all(loops.filter((audio) => !audio.paused).map((audio) => fadeVolume(audio, 0, fadeMs)));
  }
  loops.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  });
  dashboardLoops.clear();
  emitSoundState();
}

async function stopScenarioSound(fadeMs = 0) {
  scenarioAudio = null;
  const loops = [...scenarioLoops];
  if (fadeMs > 0) {
    await Promise.all(loops.filter((audio) => !audio.paused).map((audio) => fadeVolume(audio, 0, fadeMs)));
  }
  loops.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  });
  scenarioLoops.clear();
  emitSoundState();
}

async function syncDashboardSound() {
  const version = ++soundSyncVersion;
  if (!isSoundscapeEnabled() || currentMood !== 'home') {
    await stopDashboardSound();
    return;
  }
  const asset = await getSoundAsset('sound_dashboard');
  if (version !== soundSyncVersion || !asset || !isSoundscapeEnabled() || currentMood !== 'home') return;
  if (dashboardAudio?.dataset.soundUrl === asset.url) return;

  const previous = dashboardAudio;
  if (previous) await stopDashboardSound();
  if (version !== soundSyncVersion || !isSoundscapeEnabled() || currentMood !== 'home') return;
  const audio = new Audio(asset.url);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.dataset.soundUrl = asset.url;
  applySoundCrop(audio, asset);
  observeLoopState(audio);
  dashboardAudio = audio;
  dashboardLoops.add(audio);
  try {
    await audio.play();
    if (version !== soundSyncVersion || dashboardAudio !== audio) {
      audio.pause();
      dashboardLoops.delete(audio);
      return;
    }
    void fadeVolume(audio, DASHBOARD_VOLUME);
    emitSoundState();
  } catch {
    dashboardLoops.delete(audio);
    if (dashboardAudio === audio) dashboardAudio = null;
    emitSoundState();
  }
}

/**
 * Enables only real Instructor-uploaded ambient tracks. We deliberately do
 * not synthesize background drones: those read as electronic noise.
 */
export async function setSoundscapeEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  if (enabled) {
    const context = getAudioContext();
    if (context?.state === 'suspended') await context.resume();
    // Prime the short button sound while the user has provided a gesture.
    void getSoundUrl('sound_button');
    await setSoundscapeMood(currentMood);
  } else {
    await Promise.all([stopDashboardSound(), stopScenarioSound()]);
  }
  emitSoundState();
}

export async function setSoundscapeMood(mood: SoundMood) {
  currentMood = mood;
  if (mood === 'home') {
    // Bring the dashboard bed in before releasing the focused screen so the
    // transition has no dead-air gap.
    await syncDashboardSound();
    await stopScenarioSound(620);
    return;
  }
  await setScenarioSound(moodSoundSlots[mood] || null);
}

/** Start or replace a looping, instructor-uploaded soundtrack for a focused activity. */
export async function setScenarioSound(type: string | null) {
  const version = ++scenarioSyncVersion;
  if (!type || !isSoundscapeEnabled()) {
    await stopScenarioSound(type ? 0 : 360);
    return;
  }
  // A focused screen always owns the atmosphere. Versioning prevents a slow,
  // stale asset request from reviving a track after another tab has opened.
  soundSyncVersion += 1;
  const asset = await getSoundAsset(type);
  if (version !== scenarioSyncVersion || !isSoundscapeEnabled()) return;
  if (!asset) {
    const previous = scenarioAudio;
    if (previous && !previous.paused) await fadeVolume(previous, 0, 360);
    if (version === scenarioSyncVersion) {
      await Promise.all([stopScenarioSound(), stopDashboardSound(360)]);
    }
    return;
  }
  if (scenarioAudio?.dataset.soundUrl === asset.url) {
    await stopDashboardSound(360);
    return;
  }

  const previous = scenarioAudio;
  const previousDashboard = dashboardAudio;
  const audio = new Audio(asset.url);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.dataset.soundUrl = asset.url;
  applySoundCrop(audio, asset);
  observeLoopState(audio);
  scenarioAudio = audio;
  scenarioLoops.add(audio);
  try {
    await audio.play();
    if (version !== scenarioSyncVersion || scenarioAudio !== audio) {
      audio.pause();
      scenarioLoops.delete(audio);
      return;
    }
    await Promise.all([
      fadeVolume(audio, 0.2),
      previous && previous !== audio && !previous.paused ? fadeVolume(previous, 0, 620) : Promise.resolve(),
      previousDashboard && !previousDashboard.paused ? fadeVolume(previousDashboard, 0, 620) : Promise.resolve(),
    ]);
    if (previous && previous !== audio) {
      previous.pause();
      previous.currentTime = 0;
      scenarioLoops.delete(previous);
    }
    if (previousDashboard) await stopDashboardSound();
    emitSoundState();
  } catch {
    scenarioLoops.delete(audio);
    if (scenarioAudio === audio) scenarioAudio = null;
    emitSoundState();
  }
}

/** Stops every looping ambient track, including tracks started by a screen that has unmounted. */
export async function stopSoundscape() {
  soundSyncVersion += 1;
  scenarioSyncVersion += 1;
  currentMood = 'default';
  await Promise.all([stopDashboardSound(), stopScenarioSound()]);
}

/** Plays only an Instructor-uploaded button sound. No generated fallback tones. */
export async function playInterfaceTone() {
  if (!isSoundscapeEnabled()) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') await context.resume();

  const customAsset = await getSoundAsset('sound_button');
  if (customAsset) {
    const audio = new Audio(customAsset.url);
    audio.volume = 0.8;
    applySoundCrop(audio, customAsset, false);
    try { await audio.play(); return; } catch { /* Fall back to the built-in tactile click. */ }
  }

  // An original game-like "discovery" tap: a warm wood pop with a small bright lift.
  const frameCount = Math.floor(context.sampleRate * 0.045);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] = (Math.random() * 2 - 1) * Math.exp(-index / (frameCount * 0.12));
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = currentMood === 'game' || currentMood === 'quiz' ? 0.13 : 0.09;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  source.start();

  const chime = context.createOscillator();
  const chimeGain = context.createGain();
  const now = context.currentTime;
  chime.type = 'sine';
  chime.frequency.setValueAtTime(currentMood === 'game' || currentMood === 'quiz' ? 783.99 : 659.25, now);
  chime.frequency.exponentialRampToValueAtTime(987.77, now + 0.09);
  chimeGain.gain.setValueAtTime(0.0001, now);
  chimeGain.gain.exponentialRampToValueAtTime(0.055, now + 0.008);
  chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  chime.connect(chimeGain).connect(context.destination);
  chime.start(now);
  chime.stop(now + 0.15);
}

/** Plays an instructor-uploaded event sound. No synthetic fallback is used. */
export async function playSoundEffect(type: string, volume = 0.68) {
  if (!isSoundscapeEnabled()) return;
  const asset = await getSoundAsset(type);
  if (!asset) return;
  const audio = new Audio(asset.url);
  audio.volume = Math.max(0, Math.min(1, volume));
  applySoundCrop(audio, asset, false);
  try { await audio.play(); } catch { /* A browser may require the original user gesture. */ }
}

/** Route server notifications to their instructor-managed event sound. */
export function playNotificationSound(notificationType: string, status?: string) {
  const normalizedType = String(notificationType || '').toLowerCase();
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedType === 'message') return playSoundEffect('sound_message', 0.62);
  if (normalizedType === 'challenge') return playSoundEffect('sound_challenge', 0.64);
  if (normalizedType === 'streak') return playSoundEffect('sound_streak', 0.66);
  if (normalizedType === 'award') return playSoundEffect('sound_award', 0.66);
  if (normalizedType === 'payment' && ['rejected', 'failed', 'cancelled', 'expired'].includes(normalizedStatus)) {
    return playSoundEffect('sound_purchase_failed', 0.66);
  }
  if (normalizedType === 'payment' && ['confirmed', 'successful', 'success', 'completed'].includes(normalizedStatus)) {
    return playSoundEffect('sound_purchase_success', 0.66);
  }
  if (['purchase', 'relic', 'economy'].includes(normalizedType)) return Promise.resolve();
  return playSoundEffect('sound_notification', 0.62);
}

/** A restrained timer cue; it only runs during the final red seconds of a round. */
export function playRoundWarningBeep() {
  if (!isSoundscapeEnabled()) return;
  const context = getAudioContext();
  if (!context || context.state === 'suspended') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(740, now);
  oscillator.frequency.exponentialRampToValueAtTime(590, now + 0.11);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.14);
}
