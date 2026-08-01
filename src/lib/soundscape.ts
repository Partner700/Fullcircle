const SOUND_ENABLED_KEY = 'full-circle-sound-enabled';
import { supabase } from './supabase';

export type SoundMood = 'home' | 'reading' | 'tent' | 'game' | 'quiz' | 'board' | 'awards' | 'market' | 'default';

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

function applySoundCrop(audio: HTMLAudioElement, asset: SoundAsset) {
  if (asset.start <= 0 && !asset.end) return;
  const seekToStart = () => { if (asset.start > 0) audio.currentTime = asset.start; };
  audio.addEventListener('loadedmetadata', seekToStart, { once: true });
  audio.addEventListener('timeupdate', () => {
    if (asset.end && audio.currentTime >= asset.end) audio.currentTime = asset.start;
  });
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

async function stopDashboardSound() {
  dashboardAudio = null;
  dashboardLoops.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  });
  dashboardLoops.clear();
  emitSoundState();
}

async function stopScenarioSound() {
  scenarioAudio = null;
  scenarioLoops.forEach((audio) => {
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
 * Reserved for real, licensed ambient tracks. We deliberately do not use
 * synthetic drones here: they read as electronic noise rather than music.
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
  await Promise.all([
    syncDashboardSound(),
    setScenarioSound(mood === 'home' ? null : moodSoundSlots[mood] || null),
  ]);
}

/** Start or replace a looping, instructor-uploaded soundtrack for a focused activity. */
export async function setScenarioSound(type: string | null) {
  const version = ++scenarioSyncVersion;
  if (!type || !isSoundscapeEnabled()) {
    await stopScenarioSound();
    return;
  }
  const asset = await getSoundAsset(type);
  if (version !== scenarioSyncVersion || !asset || !isSoundscapeEnabled()) return;
  if (scenarioAudio?.dataset.soundUrl === asset.url) return;

  // A screen transition must never leave a previous loop playing beneath the
  // next screen. Stop all tracked loops before starting the new scenario.
  await stopScenarioSound();
  if (version !== scenarioSyncVersion || !isSoundscapeEnabled()) return;
  const audio = new Audio(asset.url);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.dataset.soundUrl = asset.url;
  applySoundCrop(audio, asset);
  scenarioAudio = audio;
  scenarioLoops.add(audio);
  try {
    await audio.play();
    if (version !== scenarioSyncVersion || scenarioAudio !== audio) {
      audio.pause();
      scenarioLoops.delete(audio);
      return;
    }
    void fadeVolume(audio, 0.2);
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

  const customUrl = await getSoundUrl('sound_button');
  if (customUrl) {
    const audio = new Audio(customUrl);
    audio.volume = 0.8;
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
  const url = await getSoundUrl(type);
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  try { await audio.play(); } catch { /* A browser may require the original user gesture. */ }
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
