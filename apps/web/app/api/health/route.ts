import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Uptime probe for the static marketing site (D-16: the web app carries no
// authenticated surface). The AI/API service exposes its own /health on
// apps/api; deep checks live there.
export async function GET() {
  return NextResponse.json({ ok: true });
}
