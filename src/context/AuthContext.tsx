import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '../lib/supabase';
import type { Profile, Role, RoleAssignment } from '../lib/types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  roleAssignment: RoleAssignment | null;
  configError: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string, role: Role, matricule?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function clearLocalAuthStorage() {
  if (typeof window === 'undefined') return;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null;
  const expectedKey = projectRef ? `sb-${projectRef}-auth-token` : null;

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    if (expectedKey) storage.removeItem(expectedKey);
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) storage.removeItem(key);
    }
  });
}

function waitFor<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)),
  ]);
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roleAssignment, setRoleAssignment] = useState<RoleAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    if (supabaseConfigError) return;

    let prof: Profile | null = null;
    let profileError: Error | null = null;
    // A freshly restored mobile session can reach the database a beat before
    // its access token/profile query is ready. Retry briefly instead of
    // sending a valid user back to the sign-in screen.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (data) {
        prof = data as Profile;
        profileError = null;
        break;
      }
      profileError = error ? new Error(error.message) : null;
      if (attempt < 2) await pause(500 * (attempt + 1));
    }

    if (!prof && profileError) throw profileError;
    setProfile(prof as Profile | null);

    if (prof) {
      const { data: ra, error: roleError } = await supabase
        .from('role_assignments')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (roleError) throw new Error(roleError.message);
      setRoleAssignment(ra as RoleAssignment | null);
    } else {
      setRoleAssignment(null);
    }
  }, []);

  useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    let active = true;
    const initialise = async () => {
      try {
        const { data } = await waitFor(supabase.auth.getSession(), 8_000, 'Session check');
        if (!active) return;
        setSession(data.session);
        if (data.session) {
          await waitFor(loadProfile(data.session.user.id), 8_000, 'Profile loading');
        }
      } catch (error) {
        // A slow/offline Supabase request must not strand the app on its loading screen.
        console.warn('Auth initialisation could not complete:', error);
        if (active) {
          setSession(null);
          setProfile(null);
          setRoleAssignment(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialise();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) {
        (async () => {
          setLoading(true);
          try {
            await waitFor(loadProfile(sess.user.id), 8_000, 'Profile loading');
          } catch (error) {
            console.warn('Profile refresh could not complete:', error);
          } finally {
            if (active) setLoading(false);
          }
        })();
      } else {
        setProfile(null);
        setRoleAssignment(null);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (supabaseConfigError) return { error: supabaseConfigError };

    clearLocalAuthStorage();
    setLoading(true);
    setProfile(null);
    setRoleAssignment(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setLoading(false);
      return { error: error.message };
    }

    const signedInSession = data.session;
    if (!signedInSession) {
      setLoading(false);
      return { error: 'Sign-in did not return a session. Please try again.' };
    }

    setSession(signedInSession);
    try {
      await waitFor(loadProfile(signedInSession.user.id), 8_000, 'Profile loading');
      return { error: null };
    } catch (profileError) {
      console.warn('Sign-in profile handoff failed:', profileError);
      return { error: 'Your account signed in, but could not finish loading. Please try again.' };
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string, role: Role, matricule?: string) => {
      if (supabaseConfigError) return { error: supabaseConfigError };

      const normalizedEmail = email.trim().toLowerCase();
      const trimmedDisplayName = displayName.trim();

      const finishPlatformSetup = async (userId: string) => {
        const { error: rpcError } = await supabase.rpc('complete_signup', {
          p_display_name: trimmedDisplayName,
          p_role: role,
          p_matricule: matricule || null,
        });
        if (rpcError) return rpcError.message;

        await loadProfile(userId);
        return null;
      };

      const signInAndFinishSetup = async () => {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          return {
            error: 'This email already has an account, but that password did not match. Please use the original password on Sign In, or reset the password.',
          };
        }

        const userId = signInData.user?.id || signInData.session?.user.id;
        if (userId) {
          const setupError = await finishPlatformSetup(userId);
          if (setupError) return { error: `Signed in, but setup failed: ${setupError}` };
        }

        if (signInData.session) setSession(signInData.session);
        return { error: null };
      };

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { display_name: trimmedDisplayName } },
      });
      if (error) {
        if (/already registered|already exists|already been registered/i.test(error.message)) {
          return signInAndFinishSetup();
        }
        return { error: error.message };
      }

      if (data.user) {
        if (data.session) {
          setSession(data.session);
          const setupError = await finishPlatformSetup(data.user.id);
          if (setupError) return { error: `Account created, but setup failed: ${setupError}` };
          return { error: null };
        }

        return signInAndFinishSetup();
      }

      return { error: null };
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    setSession(null);
    setProfile(null);
    setRoleAssignment(null);
    clearLocalAuthStorage();

    if (supabaseConfigError) return;

    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (error) {
      console.warn('Sign out failed after local session was cleared:', error);
    } finally {
      clearLocalAuthStorage();
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const role = roleAssignment?.role || null;

  return (
    <AuthContext.Provider
      value={{ session, profile, role, roleAssignment, configError: supabaseConfigError, loading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
