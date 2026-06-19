import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import {
  AssessmentTimeline,
  type TimelineItem,
} from "@/components/AssessmentTimeline";
import { DeletePlantButton } from "@/components/DeletePlantButton";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { QuarantineAlert } from "@/components/QuarantineAlert";
import type { Plant } from "@/app/_lib/types";
import { formatDate } from "@/app/_lib/date-utils";


export const dynamic = "force-dynamic";

interface TimelineRow {
  id: string;
  created_at: string;
  health_score: number;
  photo_path: string;
  diagnosis: {
    summary?: string;
    comparison?: {
      delta?: "better" | "same" | "worse" | "unknown";
    };
  } | null;
}

export default async function PlantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  
  const { data: plantRow } = await supabase
    .from("plants")
    .select("id,user_id,name,plant_type,species,cultivar,location,cover_assessment_id,created_at")
    .eq("id", id)
    .maybeSingle();
    
  const plant = plantRow as Plant | null;
  if (!plant) notFound();

  const { data: rows } = await supabase
    .from("assessments")
    .select("id,created_at,health_score,photo_path,diagnosis")
    .eq("plant_id", id)
    .order("created_at", { ascending: false });

  const assessments = (rows ?? []) as TimelineRow[];

  const items: TimelineItem[] = await Promise.all(
    assessments.map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(a.photo_path, 60 * 60);
      return {
        id: a.id,
        plant_id: plant.id,
        created_at: a.created_at,
        health_score: a.health_score,
        summary: a.diagnosis?.summary ?? "",
        thumbnailUrl: signed?.signedUrl ?? null,
        comparisonDelta: a.diagnosis?.comparison?.delta ?? null,
      };
    }),
  );

  // Generate signed URLs for Before/After recovery slider if 2+ assessments exist
  let sliderData = null;
  if (assessments.length >= 2) {
    const latest = assessments[0];
    const oldest = assessments[assessments.length - 1];
    
    const { data: latestSigned } = await supabase.storage
      .from("photos")
      .createSignedUrl(latest.photo_path, 60 * 60);
      
    const { data: oldestSigned } = await supabase.storage
      .from("photos")
      .createSignedUrl(oldest.photo_path, 60 * 60);
      
    if (latestSigned?.signedUrl && oldestSigned?.signedUrl) {
      sliderData = {
        beforeUrl: oldestSigned.signedUrl,
        afterUrl: latestSigned.signedUrl,
        beforeDate: formatDate(oldest.created_at),
        afterDate: formatDate(latest.created_at),
      };
    }
  }

  const typeLabel = plant.plant_type ? plant.plant_type.charAt(0).toUpperCase() + plant.plant_type.slice(1) : "";
  const subLabel = [
    typeLabel,
    plant.species,
    plant.cultivar,
    plant.location,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <Link href="/plants" className="text-sm text-muted-foreground hover:underline">
          ← All plants
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{plant.name}</h1>
        <p className="text-sm text-muted-foreground">
          {subLabel || "No details provided"}
        </p>
      </div>

      <QuarantineAlert plant={plant} />

      <div className="flex items-center gap-3">
        <a
          href={`/plants/${plant.id}/assess`}
          className={buttonVariants({ size: "default" })}
        >
          {items.length === 0 ? "Assess now" : "Re-assess"}
        </a>
        <a
          href={`/plants/${plant.id}/edit`}
          className={buttonVariants({ variant: "outline", size: "default" })}
        >
          Edit
        </a>
        <DeletePlantButton plantId={plant.id} plantName={plant.name} />
      </div>

      {sliderData && (
        <section className="mt-4">
          <BeforeAfterSlider
            beforeUrl={sliderData.beforeUrl}
            afterUrl={sliderData.afterUrl}
            beforeDate={sliderData.beforeDate}
            afterDate={sliderData.afterDate}
          />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h2>
        <AssessmentTimeline items={items} />
      </section>
    </main>
  );
}

