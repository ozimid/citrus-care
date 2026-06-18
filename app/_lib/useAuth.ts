"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/app/_lib/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

function mapUser(user: SupabaseUser): AuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: user.user_metadata?.full_name ?? user.email ?? "",
    avatarUrl: user.user_metadata?.avatar_url ?? null,
  };
}

function authCallbackUrl(next: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? mapUser(session.user) : null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapUser(session.user) : null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (next = "/trees"): Promise<{ error: string | null }> => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authCallbackUrl(next),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      const message = error.message.includes("provider is not enabled")
        ? "Google sign-in is not enabled for this Supabase project yet. Expand “First-time Google setup” below."
        : error.message;
      return { error: message };
    }
    if (data?.url) {
      window.location.assign(data.url);
      return { error: null };
    }
    return { error: "Google sign-in could not start. Check Supabase Google provider settings." };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    loading,
    signIn,
    signOut,
  };
}
