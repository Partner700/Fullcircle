import { supabase } from './supabase';

export async function uploadAppFile(path: string, file: File) {
  const upload = () => supabase.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type || 'application/octet-stream',
  });
  let result = await upload();
  if (result.error && /jwt|token.*expired|invalid.*token/i.test(result.error.message)) {
    const { error } = await supabase.auth.refreshSession();
    if (error) throw new Error('Your session expired. Sign in again; your selected file has not been saved.');
    result = await upload();
  }
  if (result.error) {
    const message = result.error.message || 'Upload failed';
    if (/row.level|policy|unauthorized|permission/i.test(message)) throw new Error('Upload permission was denied. Please sign in again or ask the instructor to check storage access.');
    if (/fetch|network|timeout|connection/i.test(message)) throw new Error('The photo upload lost its connection. Check your connection and try the same photo again.');
    throw new Error(message);
  }
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
