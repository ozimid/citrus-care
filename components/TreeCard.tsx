import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { Tree } from "@/app/_lib/types";

export function TreeCard({ tree }: { tree: Tree }) {
  return (
    <Link href={`/trees/${tree.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-muted/30">
        <p className="font-medium">{tree.name}</p>
        <p className="text-sm text-muted-foreground">
          {tree.cultivar ?? "Unknown cultivar"}
          {tree.location ? ` · ${tree.location}` : ""}
        </p>
      </Card>
    </Link>
  );
}
