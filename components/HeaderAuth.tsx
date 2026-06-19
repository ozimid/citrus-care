"use client";

import { useAuth } from "@/app/_lib/useAuth";

export function HeaderAuth() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return <div className="h-7 w-16" />;
  }

  if (!user) return null;

  const initial = user.fullName.charAt(0).toUpperCase();

  async function handleSignOut() {
    await signOut();
    window.location.href = "/login";
  }

  return (
    <div className="flex items-center gap-2">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatarUrl}
          alt=""
          className="h-7 w-7 rounded-full"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white">
          {initial}
        </div>
      )}
      <button
        type="button"
        onClick={handleSignOut}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        Log out
      </button>
    </div>
  );
}
