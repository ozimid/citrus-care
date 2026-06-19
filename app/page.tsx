import { getDevLanOrigins } from "@/app/_lib/dev-lan-origins";
import { landingContent } from "@/app/_content/landing";
import { LandingPage } from "@/components/landing/LandingPage";

export default function Landing() {
  const lanOrigin = getDevLanOrigins()[0];

  return (
    <LandingPage
      content={landingContent}
      lanOrigin={lanOrigin}
      showLanBookmark={process.env.NODE_ENV === "development"}
    />
  );
}
