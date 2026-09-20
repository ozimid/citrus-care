import Link from "next/link";
import { landingContent } from "@/app/_content/landing";
import { GuideNavigation } from "@/components/guides/GuideNavigation";

export const metadata = {
  title: "Labeling your trees so photos land on the right plant — Citrus Care",
  description:
    "How arborists and arboreta label many trees: numbered aluminium tags that last 20+ years, where and how to mount them without hurting the tree, and how big a code must be to scan standing — every claim sourced.",
};

const sourceLinkClassName = "text-emerald-700 hover:underline dark:text-emerald-400";

type SourceEntry = { label: string; href?: string };

// Phase 6d — the sourced purchasing and mounting rules behind Garden Walk
// (docs/research/plant-tagging-garden-walk.md §5). Facts carry their source —
// a URL where one exists, a citation where the work is paid — and the one
// judgement of our own is labelled as such.
const SOURCES = {
  // Cited, never linked: the BMP is a paid ISA publication and the copies
  // reachable online are third-party mirrors, not ISA's own hosting.
  isa: {
    label:
      "ISA — Best Management Practices: Tree Inventories (2nd ed., pp. 11–12) — paid ISA publication, cited not linked",
  },
  bartlett: {
    label: "Bartlett Consulting — Tree Tags: FAQs (2023, PDF)",
    href: "https://www.bartlett.com/dynamic/pdf/technical-reports/tree-tagging-faqs-inventory-identification.pdf",
  },
  arnold: {
    label: "Arnold Arboretum of Harvard University — Plant Inventory Operations Manual (PDF)",
    href: "https://arboretum.harvard.edu/wp-content/uploads/2020/07/plant_inventory_operations_manual.pdf",
  },
  arnoldia: {
    label: "Arnold Arboretum — Records label creation and deployment (Arnoldia)",
    href: "https://arboretum.harvard.edu/arnoldia-stories/records-label-creation-and-deployment",
  },
  pennState: {
    label: "The Arboretum at Penn State — Plant Records Manual (via APGA, PDF)",
    href: "https://www.publicgardens.org/wp-content/uploads/2018/03/plant-records-manual-outline11072017.pdf",
  },
  houston: {
    label: "University of Houston — Tree Numbering and Reporting Guidelines (2025, PDF)",
    href: "https://www.uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/design-guidelines/tree-numbering-and-reporting-guidelines-05.2025.pdf",
  },
  ucanr: {
    label: "UC ANR — Helpful support or leftover packaging? The truth about nursery stakes and ties",
    href: "https://ucanr.edu/blog/under-solano-sun/article/helpful-support-or-leftover-packaging-truth-about-nursery-stakes-ties",
  },
  gemplers: {
    label: "Gemplers — Round numbered aluminum tree tags",
    href: "https://gemplers.com/products/round-numbered-aluminum-tree-tags",
  },
  treestuff: {
    label: "TreeStuff — Round aluminum tree tags",
    href: "https://www.treestuff.com/round-aluminum-tree-tags/",
  },
  nationalBand: {
    label: "National Band & Tag — Arboretum tags",
    href: "https://www.nationalband.com/arboretum-tags/",
  },
  wePrintBarcodes: {
    label: "WePrintBarcodes — QR code labels",
    href: "https://weprintbarcodes.com/qr-code-labels.html",
  },
  myAssetTag: {
    label: "MyAssetTag — QR asset tags",
    href: "https://www.myassettag.com/qr-asset-tags",
  },
  denso: {
    label: "Denso Wave — QR code error correction",
    href: "https://www.qrcode.com/en/about/error_correction.html",
  },
  densoQuietZone: {
    label: "Denso Wave — How to make a QR code (quiet zone)",
    href: "https://www.qrcode.com/en/howto/code.html",
  },
  paladin: {
    label: "PaladinID — What causes label adhesive failure",
    href: "https://paladinid.com/what-causes-label-adhesive-failure/",
  },
  qrlog: {
    label: "QRLog — stake plates for plant codes",
    href: "https://acemaker.qrlog.app/",
  },
  permies: {
    label: "permies.com — How do you label fruit trees? (hobbyist forum, anecdotal)",
    href: "https://permies.com/t/135517/label-fruit-trees",
  },
  research: {
    label: "Citrus Care — Plant tagging for Garden Walk (the full research, with every correction from the source check)",
    href: "https://github.com/ozimid/citrus-care/blob/main/docs/research/plant-tagging-garden-walk.md",
  },
} satisfies Record<string, SourceEntry>;

type SourceKey = keyof typeof SOURCES;

function sourceEntry(id: SourceKey): SourceEntry {
  return SOURCES[id];
}

function Source({ id, children }: { id: SourceKey; children: React.ReactNode }) {
  const { href } = sourceEntry(id);
  if (!href) return <>{children}</>;
  return (
    <a href={href} className={sourceLinkClassName}>
      {children}
    </a>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return <li className="text-sm leading-6 text-neutral-800 dark:text-neutral-200">{children}</li>;
}

export default function LabelingTreesGuide() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
      <GuideNavigation includeAllGuides />
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        Garden Walk
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Labeling your trees so photos land on the right plant</h1>

      <div className="mt-5 rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Short version
        </p>
        <p className="mt-1 text-sm leading-6 text-neutral-800 dark:text-neutral-200">
          Five trees: nothing to buy — pick the plant in the app. Around thirty: about $25 of pre-numbered
          aluminium tags, hung on a loose loop of coated wire. Two hundred: add zones and a stored walk
          order, and keep a copy of the number-to-plant map outside the garden.
        </p>
      </div>

      <p className="mt-6 text-neutral-600 dark:text-neutral-300">
        Garden Walk in the Citrus Care app lets you photograph ten trees in a row — or import yesterday’s
        camera roll at once — and files each photo on the right plant. It never guesses from the leaves:
        a photo lands on a plant because of something you chose on purpose — a number you wrote on a tag
        and typed, a code you bound to the plant, a walk order you saved. That only works when every
        tree carries a marker you can read a year from now. This page is what arborists and arboreta do,
        with the source next to each claim.
      </p>

      <h2 className="mt-10 text-xl font-semibold">The number is the identity</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <Rule>
          Every professional system keys on a short, human-readable number on a durable marker. The ISA’s
          inventory standard calls a physical marker{" "}
          <Source id="isa">
            “the surest method of finding a specific tree again that cannot easily be linked to some permanent
            reference object”
          </Source>{" "}
          — a garden of free-standing trees is exactly that case — and says each tree needs a unique number
          (ISA, Best Management Practices: Tree Inventories, 2nd ed., pp. 11–12).
        </Rule>
        <Rule>
          Bartlett’s consulting arborists write:{" "}
          <Source id="bartlett">“For most tree inventories, we recommend round, numeric brass tags”</Source>. QR
          codes are reserved for engraved arboretum-style plaques, and they tag trees even when they also record
          GPS.
        </Rule>
        <Rule>
          Arnold Arboretum has decimetre-accurate maps, still hangs a numbered label on every plant, and uses{" "}
          <Source id="arnoldia">no QR codes</Source>.
        </Rule>
        <Rule>
          In the app: type the tag number when you add a plant (the Tags card, or the numeric grid in the
          picker). A code you scan is an accelerator on top of the number, never a replacement — the number is
          what you read when the phone is in your pocket.
        </Rule>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">What lasts outdoors</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Numbered aluminium: twenty-plus years. Anything printed or hand-written: a season to three years.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <Rule>
          Anodized aluminium tags are guaranteed for{" "}
          <Source id="nationalBand">20+ years outdoors</Source>.
        </Rule>
        <Rule>
          Pre-numbered 1¼″ aluminium discs cost $21.99–$25.99 per 100 and come in ranges — 1–100, 101–200 and
          up — from <Source id="treestuff">TreeStuff</Source> or <Source id="gemplers">Gemplers</Source>. Buy
          the range that continues your numbering; do not restart at 1.
        </Rule>
        <Rule>
          Skip plastic tags: they{" "}
          <Source id="bartlett">
            “deteriorate within years and tend to crack and fall off as the tree grows in diameter”
          </Source>
          .
        </Rule>
        <Rule>
          Printed polyester stickers are UL-approved for outdoor use for up to 3 years, high-tack versions 3–5 (
          <Source id="wePrintBarcodes">WePrintBarcodes</Source>). Marker pen on a plastic label{" "}
          <Source id="permies">“wore off after about three months”</Source> in one grower’s garden — anecdotal,
          but repeated on every hobbyist forum.
        </Rule>
        <Rule>
          Squirrels{" "}
          <Source id="bartlett">“file their teeth on the edges of aluminum tags”</Source> and can take the
          number with them; Bartlett saw no such damage on brass — one consultancy’s observation, so brass is
          the upgrade, not the requirement.
        </Rule>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Where and how to mount</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <Rule>
          Bartlett places trunk tags{" "}
          <Source id="bartlett">
            “on the least obvious side of the tree at a height of about six feet”
          </Source>{" "}
          with a 2½″ or 3″ coated deck screw angled downward; screws set into sapwood are endorsed by the{" "}
          <Source id="isa">ISA inventory standard (2nd ed.)</Source>.
        </Rule>
        <Rule>
          Back the screw out every few years to keep at least an inch of clearance, or the growing trunk{" "}
          <Source id="bartlett">swallows the tag</Source>.
        </Rule>
        <Rule>
          On stems under 2″ across, use a loose loop of coated wire — never zip ties, which{" "}
          <Source id="bartlett">“become brittle and break due to sun exposure”</Source>. Loosen or remove the
          wire as the stem thickens, or it girdles the branch.
        </Rule>
        <Rule>
          Arnold Arboretum hangs labels where they are conspicuous and reachable, on opposite sides of trees
          with low branches, and gives larger trunks a single label about 12″ above the soil — on a generous
          wire loop with a{" "}
          <Source id="arnold">“curatorial twist”</Source> that keeps the wire from biting the bark.
        </Rule>
        <Rule>
          For a staked tag, leave room between the tag and the ground so mulch does not bury it, and keep it
          away from the plant’s centre so it stays reachable (
          <Source id="pennState">Penn State plant records manual</Source>).
        </Rule>
        <Rule>
          Remove the nursery stake, ties and tag after planting —{" "}
          <Source id="ucanr">“Toss it all”</Source> — because they restrict the vascular system as the trunk
          grows. Your own tag goes on afterwards, loose.
        </Rule>
        <Rule>
          Stickers do not stick to bark: adhesive fails on{" "}
          <Source id="paladin">“rough, porous, textured”</Source> surfaces. Put a sticker on a stake, a smooth
          aluminium blank or a laminated hang-tag instead; a stake plate angled about 30° is easier to scan than
          a vertical one (<Source id="qrlog">QRLog</Source> — vendor practice, not a measurement).
        </Rule>
        <Rule>
          The University of Houston files a second photo of every installed tag next to the tree’s record (
          <Source id="houston">campus tree-numbering guidelines</Source>); the app’s Tags card has a slot for
          exactly that photo.
        </Rule>
      </ul>
      <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">Our own suggestion, not arborist
        guidance:</span>{" "}
        Bartlett’s least-visible side is an aesthetic choice for client trees. If you will scan the tag with a
        phone, the side you approach from, at a height you can frame while standing, is more convenient. Pick
        one convention and use it on every tree.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Codes</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <Rule>
          Any pre-printed QR sticker works — from an office-supply roll, an asset-tag vendor, or a code you
          already own. The app only compares what it scanned to what you bound; it never opens a link, never
          stores the code’s contents, and nothing is sent anywhere.
        </Rule>
        <Rule>
          Buy codes of 40 mm or larger so you can scan standing. The often-quoted 10:1 size-to-distance rule is
          a vendor heuristic, not a standard: a 15 mm code means a 15 cm scan distance — a crouch per tree.
        </Rule>
        <Rule>
          Frame one tag per scan and let it fill the shot: a decoder needs the code, plus the four-module quiet
          zone Denso requires (<Source id="densoQuietZone">Denso Wave</Source>), to occupy a large part of the
          image. A code that is a speck in a whole-tree photo will not read.
        </Rule>
        <Rule>
          Choose matte, high-contrast stock — a silver-etched code on black anodized aluminium scans in sunlight
          (<Source id="myAssetTag">MyAssetTag</Source>).
        </Rule>
        <Rule>
          Sticker rolls only pay off at scale: metal QR tags start at a minimum of 100 (from $249.95 per 100 at{" "}
          <Source id="myAssetTag">MyAssetTag</Source>) and polyester rolls ship in{" "}
          <Source id="wePrintBarcodes">increments of 1,000</Source>. Below about two hundred trees, numbered
          aluminium and a typed number is the better buy.
        </Rule>
        <Rule>
          If you print your own — the app can generate an opaque code per plant for you to print elsewhere —
          use error-correction level Q or H, which Denso recommends{" "}
          <Source id="denso">“for factory environment where QR Code get dirty”</Source>. Level H restores up to
          30 % of a damaged code.
        </Rule>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Tags go missing — keep the map</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <Rule>
          Tags blow away, deer chew aluminium and squirrels strip numbers;{" "}
          <Source id="permies">“you need a backup system in a safe spot”</Source> is the one thing every grower
          agrees on.
        </Rule>
        <Rule>
          In the app, mark a tag as missing on the plant’s Tags card and rebind when you replace it. Profile →
          “Export spreadsheet (CSV)” writes the plant-to-tag-and-zone map for a spreadsheet, and the JSON backup
          is the restore path. Both stay on your phone until you choose to share them.
        </Rule>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Sources</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Every claim above carries its source inline; this is the same list in one place. Forum posts are
        marked anecdotal.
      </p>
      <ul aria-label="Sources" className="mt-3 space-y-2">
        {(Object.keys(SOURCES) as SourceKey[]).map((key) => {
          const { label, href } = sourceEntry(key);
          return (
            <li key={key}>
              {href ? (
                <a
                  href={href}
                  className={`inline-flex min-h-11 items-center text-sm leading-6 ${sourceLinkClassName}`}
                >
                  {label}
                </a>
              ) : (
                <span className="block text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-8 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <p className="font-medium">Ready to walk the garden with your phone?</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          The Citrus Care app runs entirely on your phone — free, no account, no subscription, and your
          photos never leave the device.
        </p>
        <a
          href={landingContent.getApp.download.href}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
        >
          Download for Android
        </a>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">Direct APK download · 161 MB · Android only</p>
        <Link
          href="/#get-the-app"
          className="mt-1 inline-flex min-h-11 items-center text-sm text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
        >
          Installation instructions
        </Link>
      </div>
      <GuideNavigation includeAllGuides position="bottom" />
    </main>
  );
}
