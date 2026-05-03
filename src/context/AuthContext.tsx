import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "@/lib/supabaseClient";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchOrCreateProfile(userId: string, email: string, fullName?: string): Promise<Profile | null> {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, username, full_name, xp, level, subscription_status")
    .eq("id", userId)
    .single();

  if (existing) return existing as Profile;

  const { data: created } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      username: email.split("@")[0],
      full_name: fullName ?? null,
      xp: 0,
      level: 1,
      subscription_status: "free",
    })
    .select("id, username, full_name, xp, level, subscription_status")
    .single();

  return (created as Profile) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(u: User) {
    const p = await fetchOrCreateProfile(
      u.id,
      u.email ?? "",
      u.user_metadata?.full_name as string | undefined
    );
    setProfile(p);
  }

  useEffect(() => {
    // Get current session on mount
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUpWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (user) await loadProfile(user);
  }

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
