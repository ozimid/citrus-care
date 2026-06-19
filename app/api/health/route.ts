import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/app/_lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, boolean> = {
    gemini: false,
    supabase: false,
  };

  // Test Gemini API key
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Say OK",
      config: { maxOutputTokens: 5 },
    });
    checks.gemini = !!res.text;
  } catch (e) {
    console.error("[/api/health] Gemini check failed:", (e as Error).message);
  }

  // Test Supabase connectivity
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("plants").select("id").limit(1);
    checks.supabase = !error;
  } catch (e) {
    console.error("[/api/health] Supabase check failed:", (e as Error).message);
  }

  const ok = checks.gemini && checks.supabase;

  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 503 });
}
