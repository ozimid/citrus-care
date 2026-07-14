"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PhotoCaptureProps {
  onCapture: (file: File) => void | Promise<void>;
  busy?: boolean;
  /** Called when user picks a different photo or clears selection. */
  onSelectionChange?: () => void;
}

export function PhotoCapture({ onCapture, busy = false, onSelectionChange }: PhotoCaptureProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    onSelectionChange?.();
  }

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    onSelectionChange?.();
  }

  async function handleAnalyze() {
    if (!selectedFile || busy) return;
    await onCapture(selectedFile);
  }

  return (
    <div className="space-y-4">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
        disabled={busy}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
        disabled={busy}
      />

      {previewUrl && (
        <div className="overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Selected leaf"
            className="aspect-square w-full object-cover"
          />
        </div>
      )}

      {selectedFile && !busy && (
        <Button type="button" size="lg" className="w-full" onClick={handleAnalyze}>
          <Sparkles className="size-4" /> Analyze this photo
        </Button>
      )}

      {busy ? (
        <Button type="button" size="lg" className="w-full" disabled>
          <Loader2 className="size-4 animate-spin" /> Working…
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => galleryRef.current?.click()}
          >
            <ImageIcon className="size-4" />
            {selectedFile ? "Change photo" : "Choose photo"}
          </Button>
          <Button
            type="button"
            size="lg"
            variant={selectedFile ? "outline" : "default"}
            className="w-full"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="size-4" /> Take photo
          </Button>
        </div>
      )}

      {selectedFile && !busy && (
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground hover:underline"
          onClick={clearSelection}
        >
          Remove photo
        </button>
      )}
    </div>
  );
}
