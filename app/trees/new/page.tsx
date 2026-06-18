import { NewTreeForm } from "./new-tree-form";

export default function NewTreePage() {
  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add a tree</h1>
        <p className="text-sm text-muted-foreground">
          Give it a name you will recognise. Cultivar and location are optional
          but help the AI tailor advice.
        </p>
      </div>
      <NewTreeForm />
    </main>
  );
}
