"use client";

import { useRef, useState, useTransition } from "react";
import { deletePlant } from "@/app/plants/actions";
import { Button } from "@/components/ui/button";

interface DeletePlantButtonProps {
  plantId: string;
  plantName: string;
}

export function DeletePlantButton({ plantId, plantName }: DeletePlantButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deletePlant(plantId);
        closeDialog();
      } catch (err: unknown) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to delete plant");
      }
    });
  };

  return (
    <>
      <Button
        variant="destructive"
        onClick={openDialog}
        type="button"
        className="px-4"
      >
        Delete Plant
      </Button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border bg-card text-card-foreground shadow-lg p-6 max-w-md w-full backdrop:bg-black/60 backdrop:backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="space-y-4">
          <h3 className="text-lg font-semibold tracking-tight">Delete Plant</h3>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong className="text-foreground">{plantName}</strong>? 
            This will permanently remove the plant, all of its assessments, and its uploaded photos. 
            This action cannot be undone.
          </p>

          {error && (
            <p className="text-sm font-medium text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={isPending}
              type="button"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
              type="button"
            >
              {isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
