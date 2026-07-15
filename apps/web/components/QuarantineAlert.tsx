"use client";

import { checkQuarantine } from "@citrus/shared";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Phone, Globe } from "lucide-react";

interface QuarantineAlertProps {
  plant: {
    plant_type: string;
    species?: string | null;
    name?: string | null;
    cultivar?: string | null;
    zip_code?: string | null;
  };
}

export function QuarantineAlert({ plant }: QuarantineAlertProps) {
  const result = checkQuarantine(plant.zip_code, plant);

  if (!result.inQuarantine) return null;

  const hotline = result.state === "CA" ? "1-800-491-1899" : "1-800-835-5832";
  const website = result.state === "CA" 
    ? "https://www.cdfa.ca.gov/plant/pe/InteriorExclusion/hlb.html" 
    : "https://texasagriculture.gov/Keep-Texas-Citrus-Healthy";

  return (
    <Alert className="border-amber-500 bg-amber-50/50 dark:bg-amber-950/10 text-amber-800 dark:text-amber-300">
      <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 mt-1" />
      <div className="space-y-2 col-start-2">
        <AlertTitle className="text-amber-800 dark:text-amber-300 font-semibold flex items-center gap-1.5">
          Active Citrus Quarantine Zone ({result.state})
        </AlertTitle>
        <AlertDescription className="text-amber-700/90 dark:text-amber-400/90 text-xs md:text-sm">
          {result.details}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`tel:${hotline.replace(/-/g, "")}`}
              className="inline-flex items-center gap-1 bg-amber-600 text-white hover:bg-amber-700 text-xs px-2.5 py-1.5 rounded font-medium transition-colors"
            >
              <Phone className="size-3" />
              Call {result.state} Hotline ({hotline})
            </a>
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 border border-amber-600 text-amber-700 hover:bg-amber-100/50 dark:text-amber-400 dark:hover:bg-amber-950/20 text-xs px-2.5 py-1.5 rounded font-medium transition-colors"
            >
              <Globe className="size-3" />
              Official Quarantine Info
            </a>
          </div>
        </AlertDescription>
      </div>
    </Alert>
  );
}
