"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoCapture } from "@/components/PhotoCapture";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { downscaleImage } from "@/app/_lib/image-utils";

import { QuarantineAlert } from "@/components/QuarantineAlert";
import type { Plant } from "@citrus/shared";

class AssessError extends Error {
  constructor(
    public status: number,
    message?: string,
    public retryAfter?: number,
  ) {
    super(message ?? `Assess failed (${status})`);
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof AssessError) {
    switch (e.status) {
      case 429:
        return e.retryAfter
          ? `Too many assessments. Try again in ${Math.ceil(e.retryAfter / 60)} min.`
          : "Too many assessments. Please wait and try again.";
      case 401:
        return "Session expired — please sign in again.";
      case 403:
        return "Permission denied. Please sign in again.";
      case 404:
        return "Photo not found. Please re-upload and try again.";
      case 502:
        return "The AI service returned an error. Please try again in a moment.";
      case 500:
        return "Server error — please try again.";
      default:
        return e.message;
    }
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

export function AssessClient({ plant }: { plant: Plant }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Uploaded path kept for retry without re-uploading the same photo. */
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [isCutCare, setIsCutCare] = useState(false);

  async function handleCapture(file: File) {
    setError(null);
    setBusy(true);
    try {
      let photoPath = uploadedPath;

      if (!photoPath) {
        setStatus("Preparing photo…");
        const blob = await downscaleImage(file);

        setStatus("Uploading…");
        // The API constructs the object path server-side from the authed user
        // and hands back a short-lived signed upload URL. We PUT the bytes to
        // it directly, then hand the returned photoPath to /api/assess.
        const signRes = await fetch("/api/photos/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plantId: plant.id, mime: "image/jpeg" }),
        });
        if (!signRes.ok) {
          const j = await signRes.json().catch(() => ({}));
          throw new AssessError(signRes.status, j.error);
        }
        const { photoPath: signedPath, uploadUrl } = (await signRes.json()) as {
          photoPath: string;
          uploadUrl: string;
        };

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!putRes.ok) throw new Error("Upload failed. Please try again.");

        photoPath = signedPath;
        setUploadedPath(photoPath);
      }

      setStatus("Analysing with Gemini…");
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantId: plant.id, photoPath, isCutCare }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new AssessError(res.status, j.error, j.retryAfter);
      }
      const { id: assessmentId } = (await res.json()) as { id: string };
      setUploadedPath(null);
      router.push(`/plants/${plant.id}/assessments/${assessmentId}`);
      router.refresh();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
      setStatus(null);
    }
  }

  function handleNewPhoto() {
    setUploadedPath(null);
    setError(null);
    setStatus(null);
  }

  return (
    <div className="space-y-6">
      <QuarantineAlert plant={plant} />

      <div className="flex items-start gap-3 rounded-lg border p-4 bg-muted/20">
        <input
          type="checkbox"
          id="isCutCare"
          checked={isCutCare}
          onChange={(e) => setIsCutCare(e.target.checked)}
          disabled={busy}
          className="mt-1 size-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
        />
        <div className="grid gap-1">
          <label
            htmlFor="isCutCare"
            className="text-sm font-semibold leading-none cursor-pointer"
          >
            Assess a Pruning Cut or Branch Wound
          </label>
          <p className="text-xs text-muted-foreground">
            Toggling this tells the AI to specifically evaluate the cut anatomy, check branch-collar preservation, and advise on wound recovery.
          </p>
        </div>
      </div>

      <PhotoCapture
        onCapture={handleCapture}
        busy={busy}
        onSelectionChange={handleNewPhoto}
      />
      {uploadedPath && !busy && (
        <p className="text-center text-xs text-muted-foreground">
          Photo uploaded. Tap <strong>Analyze this photo</strong> to retry without
          choosing again.
        </p>
      )}
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

