"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoCapture } from "@/components/PhotoCapture";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/app/_lib/supabase/client";
import {
  downscaleImage,
  randomFileName,
  storagePathFor,
} from "@/app/_lib/image-utils";

export function AssessClient({ treeId }: { treeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCapture(file: File) {
    setError(null);
    setBusy(true);
    try {
      setStatus("Preparing photo…");
      const blob = await downscaleImage(file);

      setStatus("Uploading…");
      const supabase = createClient();
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error("Not signed in");

      const path = storagePathFor({
        userId: user.id,
        treeId,
        mime: "image/jpeg",
        name: randomFileName(),
      });

      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);

      setStatus("Analysing with Gemini…");
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId, photoPath: path }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Assess failed (${res.status})`);
      }
      const { id: assessmentId } = (await res.json()) as { id: string };
      router.push(`/trees/${treeId}/assessments/${assessmentId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="space-y-4">
      <PhotoCapture onCapture={handleCapture} busy={busy} />
      {status && (
        <p className="text-sm text-muted-foreground" role="status">
          {status}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
