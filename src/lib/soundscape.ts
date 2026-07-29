const SOUND_ENABLED_KEY = 'full-circle-sound-enabled';
import { supabase } from './supabase';

export type SoundMood = 'home' | 'reading' | 'tent' | 'game' | 'quiz' | 'board' | 'awards' | 'market' | 'default';

let audioContext: AudioContext | null = null;
let currentMood: SoundMood = 'default';
let dashboardAudio: HTMLAudioElement | null = null;
const assetCache = new Map<string, string | null>();

/** Call after an instructor changes a shared sound so the next interaction
 * uses the new upload without requiring a browser refresh. */
export function invalidateSoundAsset(type?: 'sound_dashboard' | 'sound_button') {
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

async function getSoundUrl(type: 'sound_dashboard' | 'sound_button') {
  const cacheKey = type;
  if (assetCache.has(cacheKey)) return assetCache.get(cacheKey) || null;
  try {
    const { data, error } = await supabase
      .from('scheduled_announcements')
      .select('content, audience')
      .eq('announcement_type', type)
      .eq('is_active', true)
      .lte('publish_at', new Date().toISOString())
      .eq('audience', 'all')
      .order('publish_at', { ascending: false })
      .limit(8);
    if (error) throw error;
    const url = data?.[0]?.content?.trim() || null;
    assetCache.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

function stopDashboardSound() {
  if (!dashboardAudio) return;
  dashboardAudio.pause();
  dashboardAudio.currentTime = 0;
  dashboardAudio = null;
}

async function syncDashboardSound() {
  stopDashboardSound();
  if (!isSoundscapeEnabled() || currentMood !== 'home') return;
  const url = await getSoundUrl('sound_dashboard');
  if (!url || !isSoundscapeEnabled() || currentMood !== 'home') return;
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.22;
  dashboardAudio = audio;
  try { await audio.play(); } catch { /* The sound toggle provides the required user gesture. */ }
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
    await syncDashboardSound();
  } else stopDashboardSound();
}

export async function setSoundscapeMood(mood: SoundMood) {
  currentMood = mood;
  await syncDashboardSound();
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
