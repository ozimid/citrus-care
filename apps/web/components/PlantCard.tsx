import { Card } from "@/components/ui/card";
import type { Plant } from "@citrus/shared";

export function PlantCard({ plant }: { plant: Plant }) {
  const typeLabel = plant.plant_type ? plant.plant_type.charAt(0).toUpperCase() + plant.plant_type.slice(1) : "";
  const subLabel = [
    typeLabel,
    plant.species,
    plant.cultivar ?? "Unknown cultivar",
    plant.location,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");

  return (
    <a href={`/plants/${plant.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-muted/30">
        <p className="font-medium">{plant.name}</p>
        <p className="text-sm text-muted-foreground">
          {subLabel}
        </p>
      </Card>
    </a>
  );
}

