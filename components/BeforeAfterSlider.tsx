"use client";

import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeDate: string;
  afterDate: string;
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeDate,
  afterDate,
}: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging.current) return;
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    handleMove(e.clientX);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => handleTouchMove(e);
    const onMouseMove = (e: MouseEvent) => handleMouseMove(e);
    const onMouseUp = () => handleMouseUp();

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <Card className="overflow-hidden border bg-card text-card-foreground shadow-sm">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Visual Recovery Comparison
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Drag the slider to compare progress between your first assessment and the latest one.
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative select-none aspect-video w-full overflow-hidden bg-muted cursor-ew-resize"
        onMouseDown={() => {
          isDragging.current = true;
        }}
        onTouchStart={() => {
          isDragging.current = true;
        }}
      >
        {/* After Image (Background) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt="After recovery"
          className="absolute inset-0 size-full object-cover pointer-events-none"
        />
        <div className="absolute right-3 top-3 bg-black/60 backdrop-blur-sm text-[10px] text-white px-2 py-1 rounded font-medium z-10">
          After ({afterDate})
        </div>

        {/* Before Image (Foreground Clipped) */}
        <div
          className="absolute inset-0 size-full overflow-hidden"
          style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={beforeUrl}
            alt="Before treatment"
            className="absolute inset-0 size-full object-cover max-w-none pointer-events-none"
            style={{ width: containerRef.current?.getBoundingClientRect().width || "100%" }}
          />
        </div>
        <div className="absolute left-3 top-3 bg-black/60 backdrop-blur-sm text-[10px] text-white px-2 py-1 rounded font-medium z-10">
          Before ({beforeDate})
        </div>

        {/* Slider Divider Bar */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-md flex items-center justify-center z-20"
          style={{ left: `${sliderPosition}%` }}
        >
          <div className="size-6 rounded-full bg-white text-black shadow-lg flex items-center justify-center text-xs font-bold border border-muted">
            ↔
          </div>
        </div>
      </div>
    </Card>
  );
}
