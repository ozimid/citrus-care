import type { SupabaseClient } from "@supabase/supabase-js";

export type TryConsumeArgs = {
  supabase: SupabaseClient;
  key: string;
  limit: number;
  windowSec: number;
};

export type TryConsumeResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

export async function tryConsume(args: TryConsumeArgs): Promise<TryConsumeResult> {
  const { data, error } = await args.supabase.rpc("consume_rate_limit", {
    _key: args.key,
    _limit: args.limit,
    _window_sec: args.windowSec,
  });

  if (error) {
    console.error("[rate-limit] consume_rate_limit RPC failed:", error.message);
    return { ok: false, remaining: 0, retryAfterSec: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, remaining: 0, retryAfterSec: 0 };

  const count = Number(row.count ?? 0);
  const allowed = Boolean(row.allowed ?? false);
  const retryAfterSec = Number(row.retry_after_sec ?? 0);
  const remaining = Math.max(0, args.limit - count);

  return { ok: allowed, remaining, retryAfterSec };
}
