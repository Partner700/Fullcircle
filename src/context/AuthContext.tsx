import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '../lib/supabase';
import { fetchOwnProfile } from '../lib/profileAccess';
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
  const authOperationRef = useRef(false);
  const profileRef = useRef<Profile | null>(null);
  const profileLoadRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const loadProfile = useCallback((userId: string) => {
    if (supabaseConfigError) return Promise.resolve();
    if (profileLoadRef.current?.userId === userId) return profileLoadRef.current.promise;

    const request = (async () => {
      // The bootstrap RPC returns the signed-in person's private profile and
      // active role in one round trip. Retry briefly while a restored mobile
      // token settles, then retain the older two-query path as rollout safety.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const bootstrap = await supabase.rpc('get_my_app_bootstrap');
        const payload = bootstrap.data as { profile?: Profile | null; role_assignment?: RoleAssignment | null } | null;
        if (!bootstrap.error && payload?.profile) {
          const prof = payload.profile;
          const assignment = payload.role_assignment || {
            id: `fallback-${userId}`,
            user_id: userId,
            role: 'cadet' as Role,
            status: 'active',
            start_date: null,
            approver_id: null,
            created_at: prof.created_at || new Date().toISOString(),
          };
          profileRef.current = prof;
          setProfile(prof);
          setRoleAssignment(assignment);
          window.localStorage.setItem('full-circle-role-hint', assignment.role);
          return;
        }
        if (attempt < 2 && !/could not find the function|get_my_app_bootstrap|schema cache/i.test(bootstrap.error?.message || '')) {
          await pause(350 * (attempt + 1));
          continue;
        }
        break;
      }

      const rolePromise = supabase
        .from('role_assignments')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let prof: Profile | null = null;
      let profileError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          prof = await fetchOwnProfile(userId);
          if (prof) break;
        } catch (error) {
          profileError = error instanceof Error ? error : new Error('Profile loading failed.');
        }
        if (attempt < 2) await pause(500 * (attempt + 1));
      }
      if (!prof && profileError) throw profileError;

      profileRef.current = prof;
      setProfile(prof);
      if (!prof) {
        setRoleAssignment(null);
        return;
      }

      const { data: roleData, error: roleError } = await rolePromise;
      if (roleError) console.warn('Role assignment could not load; opening with cadet defaults:', roleError);
      const assignment = (roleData as RoleAssignment | null) || {
        id: `fallback-${userId}`,
        user_id: userId,
        role: 'cadet' as Role,
        status: 'active',
        start_date: null,
        approver_id: null,
        created_at: prof.created_at || new Date().toISOString(),
      };
      setRoleAssignment(assignment);
      window.localStorage.setItem('full-circle-role-hint', assignment.role);
    })();

    const shared = request.finally(() => {
      if (profileLoadRef.current?.promise === shared) profileLoadRef.current = null;
    });
    profileLoadRef.current = { userId, promise: shared };
    return shared;
  }, []);

  useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    let active = true;
    let listenerSession: Session | null | undefined;
    let recoveredSession: Session | null = null;
    const initialise = async () => {
      try {
        const { data } = await waitFor(supabase.auth.getSession(), 8_000, 'Session check');
        if (!active) return;
        recoveredSession = data.session;
        setSession(data.session);
        if (data.session) {
          await waitFor(loadProfile(data.session.user.id), 8_000, 'Profile loading');
        }
      } catch (error) {
        // A slow/offline Supabase request must not strand the app on its loading screen.
        console.warn('Auth initialisation could not complete:', error);
        if (active && !listenerSession) {
          setSession(recoveredSession);
          if (!recoveredSession) {
            setProfile(null);
            setRoleAssignment(null);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialise();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, sess) => {
      listenerSession = sess;
      // A retained-session replacement can emit a late SIGNED_OUT/INITIAL_SESSION
      // event while signIn is already establishing the requested account. The
      // successful password session is authoritative during that handoff.
      if (!sess && authOperationRef.current) return;
      if (event === 'INITIAL_SESSION') {
        if (!active) return;
        if (!sess) {
          setSession(null);
          setProfile(null);
          setRoleAssignment(null);
          setLoading(false);
          return;
        }
        setSession(sess);
        // Supabase warns against starting another Supabase request inside an
        // auth callback. Deferring avoids a mobile session-restoration deadlock.
        window.setTimeout(() => {
          if (!active) return;
          void waitFor(loadProfile(sess.user.id), 8_000, 'Profile loading')
            .catch((error) => console.warn('Initial mobile session profile could not load:', error))
            .finally(() => { if (active) setLoading(false); });
        }, 0);
        return;
      }
      setSession(sess);
      // A refreshed token does not change the profile or role. Avoid turning a
      // quick token refresh into a full-screen loading state.
      if (event === 'TOKEN_REFRESHED') return;
      if (sess) {
        // signIn performs this handoff itself. Suppressing the duplicate mobile
        // callback avoids two competing profile requests on slower devices.
        if (authOperationRef.current) return;
        const needsBlockingLoad = profileRef.current?.id !== sess.user.id;
        window.setTimeout(() => void (async () => {
          if (!active) return;
          if (needsBlockingLoad) setLoading(true);
          try {
            await waitFor(loadProfile(sess.user.id), 8_000, 'Profile loading');
          } catch (error) {
            console.warn('Profile refresh could not complete:', error);
          } finally {
            if (active && needsBlockingLoad) setLoading(false);
          }
        })(), 0);
      } else {
        profileRef.current = null;
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

    authOperationRef.current = true;
    setLoading(true);
    setProfile(null);
    profileRef.current = null;
    setRoleAssignment(null);
    try {
      // signInWithPassword replaces any retained local session atomically.
      // Signing out first creates a race where a delayed SIGNED_OUT event can
      // erase the new session after a successful login on slower devices.
      const { data, error } = await waitFor(
        supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
        20_000,
        'Sign-in',
      );
      if (error) return { error: error.message };

      const signedInSession = data.session;
      if (!signedInSession) {
        return { error: 'Sign-in did not return a session. Please try again.' };
      }

      setSession(signedInSession);
      await waitFor(loadProfile(signedInSession.user.id), 15_000, 'Profile loading');
      return { error: null };
    } catch (signInError) {
      console.warn('Mobile sign-in could not complete:', signInError);
      const message = signInError instanceof Error ? signInError.message : '';
      return {
        error: /timed out/i.test(message)
          ? 'The connection took too long. Check your internet connection and try again.'
          : 'Your account could not finish signing in. Please try again.',
      };
    } finally {
      authOperationRef.current = false;
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
    authOperationRef.current = true;
    setLoading(false);
    setSession(null);
    profileRef.current = null;
    setProfile(null);
    setRoleAssignment(null);

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
      authOperationRef.current = false;
      setLoading(false);
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
