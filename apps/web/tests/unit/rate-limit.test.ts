import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryConsume } from "@/app/_lib/rate-limit";

function rpcReturning(row: object | null, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: row ? [row] : null, error });
  return {
    rpc,
    client: { rpc } as unknown as Parameters<typeof tryConsume>[0]["supabase"],
  };
}

describe("tryConsume (via consume_rate_limit RPC)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok=true with remaining=4 on the first call within the window", async () => {
    const { client, rpc } = rpcReturning({ count: 1, allowed: true, retry_after_sec: 0 });
    const res = await tryConsume({ supabase: client, key: "assess", limit: 5, windowSec: 3600 });
    expect(res).toEqual({ ok: true, remaining: 4, retryAfterSec: 0 });
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _key: "assess",
      _limit: 5,
      _window_sec: 3600,
    });
  });

  it("returns ok=true with remaining=0 when count equals the limit exactly", async () => {
    const { client } = rpcReturning({ count: 5, allowed: true, retry_after_sec: 0 });
    const res = await tryConsume({ supabase: client, key: "assess", limit: 5, windowSec: 3600 });
    expect(res).toEqual({ ok: true, remaining: 0, retryAfterSec: 0 });
  });

  it("returns ok=false with retryAfterSec>0 when over the limit", async () => {
    const { client } = rpcReturning({ count: 6, allowed: false, retry_after_sec: 1800 });
    const res = await tryConsume({ supabase: client, key: "assess", limit: 5, windowSec: 3600 });
    expect(res.ok).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSec).toBe(1800);
  });

  it("returns ok=false generically when the RPC errors (does NOT block legit traffic forever; ok=false is the safe default)", async () => {
    const { client } = rpcReturning(null, { message: "boom" });
    const res = await tryConsume({ supabase: client, key: "assess", limit: 5, windowSec: 3600 });
    expect(res.ok).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSec).toBe(0);
  });
});
