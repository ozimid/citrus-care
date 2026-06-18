"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PhotoCaptureProps {
  onCapture: (file: File, previewUrl: string) => void | Promise<void>;
  busy?: boolean;
  buttonLabel?: string;
}

export function PhotoCapture({
  onCapture,
  busy = false,
  buttonLabel = "Take or choose photo",
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    await onCapture(file, url);
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
        disabled={busy}
      />

      {previewUrl && (
        <div className="overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Captured leaf"
            className="aspect-square w-full object-cover"
          />
        </div>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Working…
          </>
        ) : (
          <>
            <Camera className="size-4" /> {buttonLabel}
          </>
        )}
      </Button>
    </div>
  );
}
