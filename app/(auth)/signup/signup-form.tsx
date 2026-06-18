"use client";

import { useActionState, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { signup, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

// Cloudflare's always-passing test site key so local dev / e2e never block on a real challenge.
const FALLBACK_TEST_SITE_KEY = "1x00000000000000000000AA";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, initial);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const siteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || FALLBACK_TEST_SITE_KEY;

  return (
    <form
      action={(fd) => {
        if (captchaToken) fd.set("captchaToken", captchaToken);
        formAction(fd);
        turnstileRef.current?.reset();
        setCaptchaToken("");
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">8+ characters.</p>
      </div>
      <div>
        <Turnstile
          ref={turnstileRef}
          siteKey={siteKey}
          onSuccess={(t) => setCaptchaToken(t)}
          onError={() => setCaptchaToken("")}
          onExpire={() => setCaptchaToken("")}
          options={{ theme: "auto" }}
        />
      </div>
      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || !captchaToken}
        className="w-full"
        size="lg"
      >
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
