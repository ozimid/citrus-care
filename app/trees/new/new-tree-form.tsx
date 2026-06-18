"use client";

import { useActionState } from "react";
import { createTree, type TreeFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CITRUS_CULTIVARS } from "@/app/_lib/tree-schemas";

const initial: TreeFormState = {};

export function NewTreeForm() {
  const [state, formAction, pending] = useActionState(createTree, initial);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          placeholder="e.g. Mr Lemon by the door"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cultivar">Cultivar</Label>
        <select
          id="cultivar"
          name="cultivar"
          defaultValue=""
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Select (optional)</option>
          {CITRUS_CULTIVARS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          name="location"
          maxLength={80}
          placeholder="e.g. South patio, indoors by window"
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full" size="lg">
        {pending ? "Adding…" : "Add tree"}
      </Button>
    </form>
  );
}
