"use client";

import { useActionState, useState } from "react";
import { updatePlant } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLANT_TYPES, CITRUS_CULTIVARS } from "@/app/_lib/plant-schemas";
import type { Plant } from "@/app/_lib/types";

export function EditPlantForm({ plant }: { plant: Plant }) {
  const updatePlantWithId = updatePlant.bind(null, plant.id);
  const [state, formAction, pending] = useActionState(updatePlantWithId, {});
  const [plantType, setPlantType] = useState<string>(plant.plant_type || "tree");

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          defaultValue={plant.name}
          placeholder="e.g. Mr Lemon by the door"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="plant_type">Plant Type</Label>
          <select
            id="plant_type"
            name="plant_type"
            value={plantType}
            onChange={(e) => setPlantType(e.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
          >
            {PLANT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="species">Species</Label>
          <Input
            id="species"
            name="species"
            maxLength={80}
            defaultValue={plant.species || ""}
            placeholder="e.g. Citrus limon, Rosa rubiginosa (optional)"
          />
        </div>
      </div>

      {plantType === "tree" ? (
        <div className="space-y-2">
          <Label htmlFor="cultivar">Cultivar (Citrus)</Label>
          <select
            id="cultivar"
            name="cultivar"
            defaultValue={plant.cultivar || ""}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
          >
            <option value="">Select (optional)</option>
            {CITRUS_CULTIVARS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="cultivar">Cultivar / Variety</Label>
          <Input
            id="cultivar"
            name="cultivar"
            maxLength={60}
            defaultValue={plant.cultivar || ""}
            placeholder="e.g. Knock Out, Haas (optional)"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            name="location"
            maxLength={80}
            defaultValue={plant.location || ""}
            placeholder="e.g. South patio, indoors by window"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="zip_code">ZIP Code</Label>
          <Input
            id="zip_code"
            name="zip_code"
            maxLength={10}
            defaultValue={plant.zip_code || ""}
            placeholder="e.g. 90210"
          />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full" size="lg">
        {pending ? "Saving Changes…" : "Save Changes"}
      </Button>
    </form>
  );
}
