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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roleAssignment, setRoleAssignment] = useState<RoleAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    if (supabaseConfigError) return;

    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(prof as Profile | null);

    if (prof) {
      const { data: ra } = await supabase
        .from('role_assignments')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setRoleAssignment(ra as RoleAssignment | null);
    }
  }, []);

  useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) {
        (async () => {
          await loadProfile(sess.user.id);
        })();
      } else {
        setProfile(null);
        setRoleAssignment(null);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (supabaseConfigError) return { error: supabaseConfigError };

    clearLocalAuthStorage();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    return { error: error?.message || null };
  }, []);

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
