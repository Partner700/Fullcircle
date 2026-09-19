import { supabase } from './supabase';

export async function uploadAppFile(path: string, file: File) {
  const upload = () => supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
    cacheControl: '31536000',
  });
  let result: Awaited<ReturnType<typeof upload>> | null = null;
  let lastThrown: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await upload();
      if (!result.error) break;
      if (/jwt|token.*expired|invalid.*token/i.test(result.error.message) && attempt === 0) {
        const { error } = await supabase.auth.refreshSession();
        if (error) throw new Error('Your session expired. Sign in again; your selected file has not been saved.');
        continue;
      }
      if (!/fetch|network|timeout|connection|gateway/i.test(result.error.message || '') || attempt === 2) break;
    } catch (error) {
      lastThrown = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 650 * (attempt + 1)));
  }
  if (!result && lastThrown) throw lastThrown;
  if (!result) throw new Error('The photo upload could not start. Please try again.');
  if (result.error) {
    const message = result.error.message || 'Upload failed';
    if (/row.level|policy|unauthorized|permission/i.test(message)) throw new Error('Upload permission was denied. Please sign in again or ask the instructor to check storage access.');
    if (/fetch|network|timeout|connection/i.test(message)) throw new Error('The photo upload lost its connection. Check your connection and try the same photo again.');
    throw new Error(message);
  }
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
