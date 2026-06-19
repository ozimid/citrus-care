import { NewPlantForm } from "./new-plant-form";

export default function NewPlantPage() {
  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add a plant</h1>
        <p className="text-sm text-muted-foreground">
          Give it a name you will recognise. Plant type is required, and species, cultivar, 
          location, and ZIP code are optional but help the AI tailor its advice.
        </p>
      </div>
      <NewPlantForm />
    </main>
  );
}

