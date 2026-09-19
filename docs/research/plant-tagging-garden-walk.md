---
date: 2026-09-19
last_updated: 2026-09-19
purpose: Source-verified research behind F39 "Garden Walk" — how people who label many trees actually identify them, a verdict on every candidate mechanism (numbered tags, QR stickers, app-generated codes, engraved plaques, NFC, GPS, separator shot, in-photo detection, walk order, printing), the recommendation at 5 / 30 / 200 trees, and the purchasing and mounting rules that feed the in-app card and the web guide.
status: complete — every correction from the source check is applied; feeds docs/design/garden-walk.md
sources:
  - International Society of Arboriculture (BMP — Tree Inventories, 2nd ed.; Arboriculture & Urban Forestry 24(3)); Bartlett Consulting (Tree Tags: FAQs, 2023 ed.)
  - Arnold Arboretum of Harvard University (Plant Inventory Operations Manual; Arnoldia); The Arboretum at Penn State (Plant Records Manual, via APGA)
  - New York Botanical Garden; Cambridge University Botanic Garden; Missouri Botanical Garden; Hortis; University of Houston Facilities (Tree Numbering Guidelines, 2025)
  - USDA Forest Service / MSU Extension (Urban Tree Monitoring field guide); i-Tree Eco; Cornell Urban Horticulture Institute; Wisconsin DNR; UConn IPM (USDA applicator recordkeeping); UC ANR; Intermountain Fruit IPM; Ask Extension
  - People's Trust for Endangered Species; Montezuma Orchard Restoration Project; Royal Botanic Garden Edinburgh (DiSSCo digitisation workflow); Botanical Research Institute of Texas (herBAR)
  - gps.gov; PLOS ONE; PMC (Forests); Frontiers in Plant Science; arXiv (Tree-SLAM)
  - Google (ML Kit Terms of Service, ML Kit barcode docs, Android developer docs); Expo docs and issue tracker; react-native-nfc-manager wiki
  - Denso Wave (qrcode.com); tag and label vendors (Gemplers, TreeStuff, National Band & Tag, IdentificationTags.com, MyAssetTag, WePrintBarcodes, Plantsoon, tagstand, NFCnTag, PaladinID, additem.to, Avery, Commonlands)
  - Field-software vendors (TreePlotter / PlanIT Geo, Hectre, Esri, Fulcrum, Vinifera, Vine Line, GardenOS, PLNTRK, QRLog, Latschbacher); consumer plant apps (Planta, Gardenize, Pl@ntNet, Seed to Spoon, Leaftide); iNaturalist forum
  - Hobbyist forums, marked anecdotal throughout (permies, growingfruit.org, Home Orchard Society, Empress of Dirt)
  - Android Authority (a news blog — the only source found for the Photo Picker location-redaction claim; flagged as such wherever used)
---

# Plant tagging for Garden Walk — how many-tree gardeners identify a tree, and what F39 should do about it

Citrus Care is a fully on-device Android app: no backend, no accounts, and nothing leaves the phone. F39 "Garden Walk"
adds bulk photos onto *existing* trees — ten trees shot in a row in-app, or yesterday's stock-camera roll imported at
once — with each photo landing on the right plant by **deterministic identification** (a number the user wrote and typed,
a code the user bound, a separator photo the user shot on purpose, a walk order the user saved) and never by the model.
Two decisions were taken on 2026-09-19 before this document was finalised, and they shape how the evidence is read:

- **Google ML Kit is not used.** Its Terms (updated 2025-05-14) say the APIs "may contact Google servers from time to time"
  and "send metrics about the performance and utilization of the APIs in your app to Google"
  (https://developers.google.com/ml-kit/terms) — a third network destination an airplane-mode test cannot rule out.
  `expo-camera`'s scanner is disabled (`barcodeScannerEnabled: false`), which strips ML Kit from the APK.
- **QR decoding is pure JavaScript** — `jsqr` on `jpeg-js` pixels — run on a **deliberately captured 800 px photo**
  ("Scan tag") or on the 800 px copy of an imported photo. QR only in v1.

Consequently every statement the research made about `scanFromURLAsync` or ML Kit decode limits is re-framed here as:
**the same physics applies to a pure-JS decoder — the code must fill a large part of the frame.** ML Kit's documented
floor (≥ 2 px per module) and Expo's caveat ("the barcode should take up the majority of the image") are properties of
the *image*, not of Google's library, and hold for `jsqr` too. Facts carry URLs; judgments are ours.

## 1. Question and scope

**Asked (2026-09-19):** for F39, which identification mechanism to build and to recommend at 5 / 30 / 200 trees; whether
app-generated codes are worth having; whether NFC or GPS earn a native dependency; and what the people who already label
many trees have learned that the plan was missing.

**Method:** five angle sweeps run in parallel — (1) record-keeping practice and data shapes, (2) machine-readable codes
outdoors and what a decoder needs, (3) position-based identification and Android EXIF, (4) what apps and institutions
actually ship, (5) how many-tree gardeners physically label — then one synthesis, then an adversarial source check that
re-read every load-bearing quote against its page. The check returned *needs changes* with 7 unsupported or
misattributed claims and 12 corrections; all are applied in the body and listed in §8.

**Sourcing hygiene:** the two most load-bearing documents — the ISA *BMP — Tree Inventories* (2nd ed.) and Bartlett's
*Tree Tags: FAQs* (2023) — are scanned image PDFs that fetch tooling cannot read as text. Both were verified by manual
page reading; any future re-verification must go the same route or those claims will silently default to "unsupported".

**Out of scope:** the queue, runner and storage architecture — the design contract's job (`docs/design/garden-walk.md`).

## 2. What practitioners actually do

The finding all five sweeps converge on: **the professional primary key is a short human-readable number on a durable
physical marker; machine-readable codes are an accelerator layered on top; GPS is never the identifier.**

**Arborists — ISA and Bartlett.** The ISA BMP (2nd ed., p. 12, "Detailed Location—Randomly Distributed Trees"): *"A
physical marker of some kind is the surest method of finding a specific tree again that cannot easily be linked to some
permanent reference object"* (http://unri.org/ECO%20697U%20S14/Tree%20Inventories%20BMP-ISA%202.pdf). Note the scope —
markers for trees that lack a permanent reference (a garden of free-standing trees is that case), not markers over every
other method; p. 11 adds that *"each tree needs a unique number in addition to the one assigned to the site it
occupies."* Bartlett's 2023 FAQ is the most concrete field document found: *"For most tree inventories, we recommend
round, numeric brass tags"*, QR is reserved for *"custom arboretum style"* plaques, and *"we always recommend tagging
trees as well as collecting GPS information to ensure positive tree identification"*
(https://www.bartlett.com/dynamic/pdf/technical-reports/tree-tagging-faqs-inventory-identification.pdf). **Caveat:**
that paragraph opens by calling GPS *"an accurate (within 1 meter) method"*, contradicting the gps.gov and PLOS ONE
figures in §3 — Bartlett is an authority for "tag *and* GPS, never GPS alone", not for how inaccurate phone GPS is.
Latschbacher's urban-forestry cadastre keeps **two numbers per tree** — physical tag number and inventory sequence — and
installs 120–200 tags an hour with a purpose-built hammer
(https://www.latschbacher.com/en/tagging-technology/signumat-urban-forest-line/). Cornell keys street trees on a unique
Tree ID located by address and sequence, GPS only for park trees, no physical tag
(https://blogs.cornell.edu/urbanhort/outreach/community-forestry/conducting-a-street-tree-inventory/). The University
of Houston mounts 1.25-inch brass tags at 4.5 ft, numbered `YY-XXX`, and requires a **second photo of the installed
tag** filed as `YY-XXX_Z`
(https://www.uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/design-guidelines/tree-numbering-and-reporting-guidelines-05.2025.pdf).

**Arboreta.** Arnold Arboretum labels plants *"as a general rule"* with two anodized aluminium records labels, *"placed
opposite one another on trees with low hanging branches. Accessibility is critical and every effort is made to hang
the labels in conspicuous locations"* — the stated reason is accessibility and sightlines, **not redundancy against
failure**; trees over 15 cm DBH without low branches get a single screw-mounted trunk label. Its field loop is *"After
all observations and clerical efforts are complete, proceed to the next plant"*; it ships a condition code `U — Unable
to locate` marked *USE SPARINGLY* and hangs a yellow temporary label when both records labels are missing
(https://arboretum.harvard.edu/wp-content/uploads/2020/07/plant_inventory_operations_manual.pdf). Its maps are
decimetre-accurate, it still tags every plant, and it uses no QR codes
(https://arboretum.harvard.edu/arnoldia-stories/records-label-creation-and-deployment). Penn State uses
`2009-0003*AA` (accession + position qualifier), tracks a `Label type OK` field, never deletes deaccessioned records,
has a named `Reaccessioned` repair, and pairs its iPad with an external EOS Arrow 100 receiver for 30–60 cm accuracy
because the tablet alone is not good enough
(https://www.publicgardens.org/wp-content/uploads/2018/03/plant-records-manual-outline11072017.pdf). Cambridge
(`20173471*B`; https://www.botanic.cam.ac.uk/the-garden/understanding-plant-labels/), NYBG (`1/2018`; the year is the
database entry, not the plant's age; no QR anywhere; https://libguides.nybg.org/c.php?g=824991), Missouri BG (embossed
accession tags; mapping by *tapping a map*; https://www.missouribotanicalgarden.org/gardens-gardening/our-garden/plant-records)
and Hortis (*"Without this information, a plant is just a plant"*; https://www.hortis.com/blog/what-is-accessioning)
all use an opaque number plus a per-plant qualifier.

**Orchards and field software.** Hectre — a commercial orchard product — runs on orchards → blocks → sub-blocks → rows →
**tree numbers typed by a human**, with a `row 0 / tree 0` escape hatch; GPS and scanning appear nowhere in its docs
(https://hectre.helpscoutdocs.com/article/135-add-orchards-blocks-sub-blocks). PTES: *"number each tree in a row and
designate each row a letter"*; *"Putting some form of permanent markers on the trees is very important"*
(https://ptes.org/campaigns/traditional-orchard-project/orchard-practical-guides/mapping-your-orchard/). Montezuma
Orchard attaches one unique ID *"to all notes, photos, maps, and grafts"*, then re-walks to verify the map
(https://montezumaorchard.org/document-your-old-orchard/). TreePlotter offers *By Map* and *By GPS* placement and
warns device GPS is *"limited to the capability of the GPS chip"* (https://support.treeplotter.com/knowledge-base/geolocation/),
generates no QR codes itself (https://support.treeplotter.com/knowledge-base/sharing-data-with-qr-codes/), caps
*"5 photos per record"* across three record types and exports photos *"prefixed with the same number"*
(https://support.treeplotter.com/knowledge-base/tutorial-photos/). Vinifera, Esri, Survey123 and Fulcrum share one
shape — pick from a hierarchy or scan an asset ID; GPS is metadata on the observation, never the key
(https://viniferavineyardmanagement.com/features/scouting, https://doc.arcgis.com/en/arcgis-solutions/11.3/reference/use-tree-management.htm,
https://www.esri.com/arcgis-blog/products/survey123/announcements/barcode-scanning-in-survey123-for-arcgis,
https://www.fulcrumapp.com/blog/barcode-qr-code-scanning-2/). IPM scouting samples fresh random trees each week with
no per-tree marking (https://intermountainfruit.org/ipm-methods/monitoring) — per-tree identity is expensive, and
professionals skip it when statistics suffice.

**i-Tree and the USFS field guide.** i-Tree Eco requires only Species and DBH, but its schema carries **`Tree ID`
(*"> 0 without duplication"*), a separate `User Tree ID`, and a first-class `Photo ID`**
(https://www.itreetools.org/resources/manuals/Ecov6_ManualsGuides/Ecov6Guide_InventoryImporter.pdf). The USFS/MSU urban
tree monitoring guide links every tree to a `PLOT ID`, fixes the order — *"starts with the tree closest to due north and
proceeds in a clockwise direction"* — and notes *"Geographic references are important for future inventory updates"*
(pp. 4–6, https://repository.library.noaa.gov/view/noaa/41260/noaa_41260_DS1.pdf).

**Herbaria — the transferable workflow.** RBGE mass digitisation: *"A barcode is applied to each specimen"* and *"The
barcode is used as the filename for the image and this allows for later linking to the data record"*; malformed
filenames go to an errors folder (https://dissco.github.io/HerbariumSheets/RBGEHerbariumSheet.html). BRIT's herBAR
decodes Code 39 from the already-taken photo, renames the file, logs every file to CSV, offers a dry-run, and names the
three real failures: *"missing or unreadable barcodes, multiple barcodes on one image, and duplicate barcode values
across different files"* (https://github.com/BRITorg/herBAR). Shoot fast, decode from the still afterwards, review,
bind — this is Garden Walk, already solved at institutional scale.

**Consumer apps.** None solves this: Planta (https://getplanta.com/article/progressevent), Gardenize, Greg, Blossom,
PictureThis and Plantum bind a photo to a plant by the user having already tapped that plant. Gardenize's cap is
**per upload on the paid tier** — *"If you have Gardenize Plus you can add as many pictures as you want, though a
maximum of 5 pictures at a time"* — and the free tier allows one picture per plant (https://gardenize.com/faq-gardenize/);
its Areas layer is the closest consumer analogue to a garden of many trees
(https://apps.apple.com/us/app/gardenize-plant-care-journal/id1118448120). Seed to Spoon uses a spatial layout as the
picker (https://www.seedtospoon.net/app/); Pl@ntNet has no persistent plant identity
(https://docs.plantnet.org/en/tutorials/identify-a-plant/). The niche that has this problem binds on first scan:
PLNTRK (https://www.plntrk.com/) and QRLog, whose stainless stake plate is angled 30° for scanning
(https://acemaker.qrlog.app/). GardenOS independently shipped burst capture → queue → confidence ladder under the
principle *"fast data entry, not AI"* (https://gardenos.app/).

**Hobbyists — anecdotal, forum evidence, read as such.** Plastic with marker *"wore off after about three months"*,
tags blow away, deer chew aluminium; embossed copper *"Lasts basically forever"*; *"you need a backup system in a safe
spot"* (https://permies.com/t/135517/label-fruit-trees). Beverage-can aluminium tags made in 1993 were still in service
in 2009 (https://forums.homeorchardsociety.org/discuss/general-forum/permanent-labels-buy-or-make/). A 200-tree grower
keeps Excel mapped to a physical numbering system (https://growingfruit.org/t/orchard-mapping/2770); a 1,500-tree grower
proposes *"row: A, B, C, D tree: 1, 2, 3, 4"*, warns GPS *"may save coordinates that are for another (wrong) tree"*, and
that *"It's a lot of work to re-enter data into a new system"* (https://growingfruit.org/t/basic-orchard-software/26000).
A 100+-post tagging thread never mentions GPS, QR or digital inventory
(https://growingfruit.org/t/tagging-what-do-you-do/22170), and the one extension answer found is candid: *"we don't
have data collected on this"* (https://ask.extension.org/kb/faq.php?id=845716). The realistic baseline user has a
handwritten aluminium tag or nothing, plus a spreadsheet kept badly.

## 3. Mechanism verdicts

| Mechanism | Verdict | Grounding | Honest limit |
|---|---|---|---|
| **Numbered aluminium tags** (pre-numbered 1¼″ discs) | **Baseline at every garden size; the thing to recommend in onboarding.** | Bartlett's default is a numeric tag; Gemplers $25.99/100 in ranges 1–100 … 401–500 (https://gemplers.com/products/round-numbered-aluminum-tree-tags); TreeStuff $21.99/100 (https://www.treestuff.com/round-aluminum-tree-tags/); anodized aluminium *"Guaranteed to last outdoors for 20+ years"* (https://www.nationalband.com/arboretum-tags/). | Produces a **number, not a code** — typed short-number entry must be a first-class path. Squirrel damage to aluminium and the brass preference are one US consultancy's observation (Bartlett). |
| **Pre-printed QR stickers, bound by one scan** | **Keep as an accelerator, not the default.** Payload stored as a digest and never interpreted — the only design that works across vendors. | MyAssetTag minimum 100, metal from $249.95/100 (https://www.myassettag.com/qr-asset-tags); WePrintBarcodes *"increments of 1000"*, polyester *"UL Approved for outdoor use up to 3 years"*, high-tack 3–5 years (https://weprintbarcodes.com/qr-code-labels.html); Plantsoon's QR is subscription-locked (https://plantsoon.com/en/plantsigns); Hortis encodes its own URL (https://support.hortis.com/support/solutions/articles/80001151982-print-plant-labels). | **No vendor found sells 200.** Adhesive does not hold on rough, porous wood — needs a rigid carrier (https://paladinid.com/what-causes-label-adhesive-failure/). v1 decodes **QR only** (`jsqr`); 1D asset rolls are typeable, not scannable. |
| **App-generated codes** | **Yes — generate the ID and payload namespace (`CC1-…`, opaque), not the printed artefact.** Never encode meaning. | iNaturalist's QR thread: *"taxon URLs are not necessarily stable"* — a species split would mislabel every tag (https://forum.inaturalist.org/t/standard-qr-codes-for-plant-and-tree-species/42702); additem.to: *"No item data is ever encoded in the label itself"* (https://additem.to/guides/print-qr-barcode-labels); Denso: *"Level Q or H may be selected for factory environment where QR Code get dirty"* (https://www.qrcode.com/en/about/error_correction.html). | The 30 % restoration figure for level H is from ISO/IEC 18004; the Denso page states it only in an image. Printing is a separate, later question. |
| **Engraved / laser-etched QR plaques** | **A botanical-garden budget item; only if cost is irrelevant.** | IdentificationTags.com ≈ $5.13–$5.71 per tag (https://identificationtags.com/engraved-tree-tags/); National Band custom $7.00 + $35 layout at 500+ (https://www.nationalband.com/arboretum-tags/); Plantsoon signs $10–$30 each; Bartlett reserves QR plaques for particular trees. | 20–100× the cost of a numbered disc for ~1.5 s saved per tree. |
| **NFC** | **Reject at every garden size.** | HF/NFC read range 0–3 cm (https://nfcntag.com/custom-nfc-tags/custom-rfid-nail-tags/); outdoor NTAG213 $0.71–$1.00 each (https://www.tagstand.com/products/outdoor-type-2-nfc-sticker-ntag213-on-metal-circle-35mm-1/); the Expo plugin *"will ensure the minimum Android SDK version is 31"* and needs prebuild (https://github.com/revtel/react-native-nfc-manager/wiki/Expo-Go); the RFID field study found 2 of 40 tags undetected on level ground and 5 of 10 in hilly terrain (https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2016.01342/full). | You touch the trunk anyway, so it is ergonomically worse than a 40 mm QR read standing; the tag is invisible, so a printed number goes beside it — at which point the number is the system. Range figures are vendor listings, not datasheets. |
| **GPS** (`expo-location` or photo EXIF) | **Reject for identity — unambiguously.** | Smartphones *"typically accurate to within a 4.9 m (16 ft.) radius under open sky"*, worse *"near buildings, bridges, and trees"* (https://www.gps.gov/gps-accuracy); under canopy iPhone 12 Pro RMSE 3.91 m, range 2.28–9.77 m, *"sub-meter positional accuracy was not attainable by any of the devices"* (https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0283090); nine phones under forest canopy 4.56–14.59 m (https://pmc.ncbi.nlm.nih.gov/articles/PMC8838512/); mapping-grade receivers 2–5 m after correction (https://auf.isa-arbor.com/content/24/3/135). Penn State buys RTK; Bartlett tags *and* maps. | Tree-SLAM's *"less than 20 % of the planting distance"* is the system's **achieved result** (18 cm), not a threshold; its correctness criterion is **half the planting distance** — 1.5–2.5 m at 3–5 m spacing — which canopy GPS meets only marginally and only on average (https://arxiv.org/html/2507.12093). The claim that Android's Photo Picker strips EXIF location by default, with an opt-in API in the August 2026 mainline update, is sourced **only to a news blog** (https://www.androidauthority.com/android-photo-picker-location-sharing-release-3704689/); the official media and picker pages say nothing about it (https://developer.android.com/training/data-storage/shared/media, https://developer.android.com/training/data-storage/shared/photopicker). F39 never reads GPS keys regardless (D-W13). |
| **Separator shot** (tag close-up, then N tree photos) | **Build it — adopted.** Makes stock-camera photos deterministically bindable at one extra shutter press per tree, zero native dependencies. | Verbatim herbarium practice (RBGE, herBAR above). Chicago Botanic Garden's consumer tip — photograph the tag before the plants — was seen in a search snippet only. | **The same physics applies to a pure-JS decoder: the code must fill a large part of the frame.** ML Kit's ≥ 2 px/module and Expo's *"the barcode should take up the majority of the image for best results"* (https://developers.google.com/ml-kit/vision/barcode-scanning/android, https://docs.expo.dev/versions/latest/sdk/camera/) are image properties; machine-vision guidance targets 8 px/module, 6 marginal (https://commonlands.com/blogs/technical/barcode-reading-machine-vision). Arithmetic, not measurement: a 25-module QR plus the four-module quiet zone Denso requires (https://www.qrcode.com/en/howto/code.html) at 8 px/module is ≈ 264 px — about a third of an 800 px frame. **No measured decode rate exists** for `jsqr` on real garden photos; the Phase 0 probe (≥ 50 % / 15 % / 5 % of frame) is the spike. `jsqr` returns one result per call, so two tags in one frame yield one arbitrary code, not a choice — frame one tag per separator. |
| **In-photo auto-detect** (a tag incidentally in a leaf close-up) | **Suggestion chip at most — never a binder.** F39 ranks a tag-card hit on an imported photo below an explicit scan (D-W3). | Same frame-fill physics as above; a 25 mm tag two metres behind a leaf occupies a handful of pixels. | Tile-crop-and-upscale (`expo-image-manipulator`) is an unprototyped inference. |
| **Walk order** | **Build it — rank, never commit.** Highest-leverage structure at 200 trees. | USFS/MSU north → clockwise order; Arnold's explicit *"proceed to the next plant"*; Vine Line's row-by-row manual tap (https://vineline.eu/); GardenOS's queue (https://gardenos.app/). | **No app found auto-advances along a saved route, so no prior art for skipped-tree handling**; one silent skip shifts every later photo by one. Hence an explicit tap with n+1 and n−1 one tap away, and no "Accept all". |
| **Printing** (`expo-print` / view-shot) | **Not in v1** (Phase 7 export at most). | Cheapest path if ever built: pure-JS QR → SVG → HTML → `expo-file-system` → `expo-sharing`, Avery 5160/5163 grid, serial under every code (https://additem.to/guides/print-qr-barcode-labels, https://www.avery.com/category/usage/qr-code-labels/, https://docs.expo.dev/versions/latest/sdk/print/). Missouri BG embosses and laser-engraves because print does not last outdoors. | The path is an engineering inference from the dependency list, not prototyped. Print is a 1–3 season consumable against 20+ years for metal. |

## 4. Recommendation for Citrus Care at 5 / 30 / 200 trees

Keep the architecture — bind any pre-printed sticker by one scan, treat the payload as opaque, hand-written number as
co-primary, sticky "same tree" chip, EXIF-ordered time-gap suggestion — with three changes, all now in the design
contract: demote QR to accelerator and promote the typed number to co-primary (D-W4); add the separator shot decoded
from the still afterwards (D-W3, D-W15); add zone + stored walk order that ranks and never commits (D-W3).

**At 5 trees — buy nothing, build nothing special.** App-issued short IDs `1…5`, the sticky chip and a picker; five
plants fit on one screen and any mechanism is overkill. The user writes the number on whatever tag they already have.

**At 30 trees — the feature's sweet spot.** Recommend **~$26 of pre-numbered 1¼″ aluminium tags** (Gemplers $25.99/100,
range 1–100; TreeStuff $21.99/100) and bind each by typing two digits or, where the user already owns QR stickers, by
one "Scan tag". A sticker roll is poor value here: MyAssetTag's minimum is 100 at $249.95–$389.95 for metal, and
WePrintBarcodes ships in 1,000s — 70 to 970 spares. Mount per §5.

**At 200 trees — three things change, and none is "buy more technology".**

1. **Structure beats search.** A zone layer above plants with a stored walk order — the USFS/MSU `PLOT ID` + fixed order
   and PTES's row letter + tree number, in the app. `plant-store.ts` already carried a free-text `location`; F39 adds
   `zone` and `walk_order` beside `tag` and `codes`.
2. **The problem changes shape.** The question stops being "which plant is this photo?" and becomes "which 12 trees am I
   shooting today, and did I miss one?" A zone-scoped ordered checklist with a completion state answers both and makes
   the analysis queue legible up front (12 photos × ~60 s ≈ 12 min).
3. **Stickers start to pay — but the honest price is not $114.** No vendor found sells 200 labels. The real choices are
   1,000 polyester QR labels from WePrintBarcodes at $168.37–$394.61 (high-tack from $239.94) with 800 spares, or two
   MyAssetTag 100-packs at roughly $500–$780 for metal, against ≈ $1,026–$1,142 for 200 engraved aluminium-with-QR tags
   (IdentificationTags.com). Keep **$52 of numbered aluminium** (two 100-packs, ranges 1–100 and 101–200) as the
   permanent identity — 20+ years — under any polyester sticker rated 3–5 years. Buy **QR**, not 1D barcodes: v1
   decodes QR only, so an in-stock Code 128 asset roll (~$0.10 each in 1,000s,
   https://www.myassettag.com/preprinted-barcode/in-stock-barcode-labels) is typeable but not scannable.

**The single biggest UX lever is a purchasing detail.** The cheap 25×18 mm asset label carries a ~15 mm QR; by the
widely repeated 10:1 vendor heuristic that is a ~15 cm scan distance — 200 crouches per walk. **Steer users to ≥ 40 mm
codes so they can scan standing.** (10:1 is a QR-vendor heuristic, not ISO/IEC 18004 or a measured result.)

**Ranked per-photo cost at scale:** (1) separator shot / walk order / sticky chip — ~0 taps per photo, *the scaling
mechanism*; (2) scan a bound code — ~1–2 s per tree after a one-time labelling session, *the correctness mechanism*;
(3) type a 2–3 character number — ~3 s, works with $26 of aluminium and no scanning; (4) pick from a list — degrades
badly past ~30 plants unless sorted by walk order or recency; (5) auto-detect a code inside a plant photo — suggestion
only; (6) GPS — do not.

## 5. Purchasing and mounting guidance

Each rule is one sentence with its source, so it can be lifted into the in-app card and the web guide as-is.

**What to buy**

- For most inventories buy round, numeric tags — brass or aluminium — and reserve QR plaques for particular trees (Bartlett, https://www.bartlett.com/dynamic/pdf/technical-reports/tree-tagging-faqs-inventory-identification.pdf).
- Pre-numbered 1¼″ aluminium discs cost $21.99–$25.99 per 100 and come in ranges 1–100, 101–200 and up (https://www.treestuff.com/round-aluminum-tree-tags/, https://gemplers.com/products/round-numbered-aluminum-tree-tags).
- Do not buy plastic tags: they *"deteriorate within years and tend to crack and fall off as the tree grows in diameter"* (Bartlett).
- Anodized aluminium is guaranteed 20+ years outdoors; polyester stickers are UL-approved for up to 3 years, high-tack 3–5 (https://www.nationalband.com/arboretum-tags/, https://weprintbarcodes.com/qr-code-labels.html).
- Buy QR stickers of ≥ 40 mm so the code can be read standing; the 10:1 size-to-distance rule is a vendor heuristic, not a standard (§4).
- Choose matte, high-contrast stock — silver-etched code on black anodized aluminium scans in sunlight (https://www.myassettag.com/qr-asset-tags); the 10–15° anti-glare tilt is vendor best practice, not measured.
- If a QR is ever generated, use error-correction level Q or H, which Denso recommends *"for factory environment where QR Code get dirty"* (https://www.qrcode.com/en/about/error_correction.html); level H's 30 % restoration is specified by ISO/IEC 18004.
- Stickers do not stick to bark — adhesion fails on *"rough, porous, textured"* surfaces — so mount them on a stake, an aluminium blank or a laminated hang-tag (https://paladinid.com/what-causes-label-adhesive-failure/).
- A stake plate angled about 30° scans more comfortably than a vertical one (https://acemaker.qrlog.app/).

**Where and how to mount**

- Bartlett places tags *"on the least obvious side of the tree at a height of about six feet"* with a 2½″ or 3″ coated deck screw angled downward; screws set into sapwood are endorsed by the ISA BMP, 2nd ed. (Bartlett).
- Back the screw out every few years to keep at least an inch of clearance, or the tree swallows the tag (Bartlett).
- On stems under 2″ DBH use a loop of coated wire, not zip ties, which *"become brittle and break due to sun exposure"*; remove the wire later or it girdles the branch (Bartlett).
- Arnold Arboretum hangs labels in conspicuous, accessible locations, opposite one another on trees with low-hanging branches, and gives larger trees a single trunk label about 12″ above the soil line; a generous wire loop with a "curatorial twist" avoids owl-eyeing of the bark (https://arboretum.harvard.edu/wp-content/uploads/2020/07/plant_inventory_operations_manual.pdf).
- Leave space between a staked tag and the ground so mulch does not bury it, and keep it away from the plant's centre so it stays reachable (Penn State, https://www.publicgardens.org/wp-content/uploads/2018/03/plant-records-manual-outline11072017.pdf).
- Houston's campus standard mounts 1.25″ brass tags at 4.5 ft above grade and files a second photo of the installed tag as `YY-XXX_Z` (https://www.uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/design-guidelines/tree-numbering-and-reporting-guidelines-05.2025.pdf).
- Remove nursery stakes, ties and tags after planting — *"Toss it all"* — because they restrict the vascular system as the trunk grows (https://ucanr.edu/blog/under-solano-sun/article/helpful-support-or-leftover-packaging-truth-about-nursery-stakes-ties).
- Springs are disputed: Bartlett says they have *"no added benefit … other than keeping tags from jingling"*; National Band says they compress as the tree grows and keep the tag off the bark (https://www.nationalband.com/arboretum-tags/) — Bartlett is the independent party.

**What fails, so keep a backup**

- Squirrels *"file their teeth on the edges of aluminum tags"* and can remove the number and the QR code; no such damage was seen on brass — one consultancy's observation (Bartlett).
- Marker on plastic *"wore off after about three months"*, tags blow away and deer chew aluminium; *"you need a backup system in a safe spot"* — anecdotal (https://permies.com/t/135517/label-fruit-trees).
- The app is that backup only if the plant ↔ tag ↔ photo map can leave it as CSV/JSON (§6).

**Our own inference, not arborist guidance:** for scanning with a phone, a tag on the side you approach from, at a
height you can frame while standing, is more convenient than Bartlett's least-visible side — Bartlett's preference is
aesthetic (client trees), and Arnold's is sightlines. The web guide should present this as an ergonomic choice.

## 6. Additional features recommended

Ranked by how much misattribution — the failure mode of this feature — each prevents or repairs. Cost: **cheap** (pure
logic over data already held), **moderate** (new screen or pipeline, no native code), **native-dep** (would need a new
native module — none adopted). Status is against `docs/design/garden-walk.md`.

| # | Addition | Cost | Source | F39 status |
|---|---|---|---|---|
| 1 | Unassigned photo inbox — capture never blocks on identification; unassigned photos are never analysed and never lost | cheap | Arnold `U — unable to locate`; RBGE errors folder | **Adopted** (photo queue, D-W1/D-W3) |
| 2 | Tag-first separator shot decoded from the still afterwards; every following photo inherits the binding until the next separator | moderate | RBGE; herBAR; frame-fill physics (§3) | **Adopted** ("Scan tag" 800 px capture, tag-card on import, explicit run; D-W3/D-W15) |
| 3 | Review screen before the walk commits, with batch undo — at 25–120 s per photo, reviewing 30 bindings before an hour of compute is the most valuable screen | moderate | herBAR dry-run + CSV log | **Adopted** (`WalkReviewScreen`; "Undo this walk" Phase 6b) |
| 4 | Zones as a real entity with a stored walk order; rank, never auto-advance | cheap | USFS/MSU `PLOT ID` + order; PTES; Arnold "proceed to the next plant" | **Adopted** (`zone`, `walk_order`, `walk-order.ts`; auto-advance deliberately not built) |
| 5 | Two-identifier model — tag identity ≠ plant identity; several bound codes per plant, re-tag is an append | cheap | Latschbacher two numbers; i-Tree `Tree ID` + `User Tree ID` | **Adopted** (`tag` + `codes`, D-W4) |
| 6 | Binding provenance and a confidence ladder — record how each photo was bound; auto-assigned photos stay unconfirmed until acknowledged | cheap | GardenOS ladder, *"fast data entry, not AI"* | **Adopted** (`evidence` badge until the run commits) |
| 7 | Manual short-number entry as a first-class path — big numeric keypad, recent-numbers row, no ambiguous characters | cheap | Bartlett numeric tags; Hectre typed row + tree | **Adopted** (56 dp tag grid, whitelist, co-primary) |
| 8 | Explicit edge cases: unreadable / multiple / duplicate codes, each with a designed outcome | cheap | herBAR's three failures | **Adopted** (`classifyScan`, `codeOwners`, "exactly one owner" rule); multiple-in-frame is one tag per separator by construction |
| 9 | Re-tag / unbind as a two-tap flow, plus a "tag missing" plant state | cheap | Bartlett stripped tag; Arnold yellow temporary label; Penn State `Label type OK` | **Partly adopted** (codes moved from the plant's Tags card); "tag missing" state **deferred** |
| 10 | EXIF-based ordering for every import — `DateTimeOriginal` + `SubSecTimeOriginal` (+ `OffsetTimeOriginal`), never selection order; `orderedSelection` is iOS-only and Android's picker sorts newest-first | cheap | https://docs.expo.dev/versions/latest/sdk/imagepicker/, https://developer.android.com/training/data-storage/shared/photopicker, https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface | **Adopted** (`pickExifDates` whitelist, D-W13; GPS keys never read) |
| 11 | Dedicated "photo of this plant's tag" slot, plus a "how to find this tree" note | cheap | Houston second photo; ISA BMP locator attributes | **Adopted** (`tag_photo`); locator note **deferred** |
| 12 | CSV + JSON export of the plant ↔ code ↔ photo map, ID-prefixed photo filenames | cheap | TreePlotter prefix convention; permies backup; Cornell separate-file rule | **CSV adopted** (`csv-export.ts`); ID-prefixed export filenames **deferred** |
| 13 | Storage budget and photo hygiene — app-specific storage is removed on uninstall; one "Clear storage" tap wipes 200 timelines | cheap–moderate | https://developer.android.com/training/data-storage | **Adopted** (D-W11 export cap, D-W17 store guard) |
| 14 | Bulk pre-creation (`A-01…A-30`) and a scan-only bind pass separate from the walk; "log this to the zone, not a tree" escape hatch | cheap | Hectre rows with the same tree numbers, `row 0 / tree 0`; IPM random sampling | **Adopted** (`bulkPlantDrafts`, "Scan tag" binds without a plant photo); zone-level observation **deferred** |
| 15 | In-app labelling and purchasing card — three lines that decide whether the feature works (§5) | cheap | Bartlett; Arnold; UC ANR; MyAssetTag | **Adopted as planned** (§5 feeds the card and the web guide) |
| 16 | Triage-first list views — search, filter, sort by staleness, group by zone | cheap | Gardenize filtering; Leaftide comparison axes (https://leaftide.com/compare/best-orchard-tracking-app/) | **Partly adopted** (`sortByStaleness`, `groupByZone`, `filterPlantsByQuery`); full filter set **deferred** |
| 17 | Duplicate detection and merge — reparent assessments/photos/chat onto the survivor | cheap | i-Tree *"without duplication"*; Penn State `Reaccessioned` | **Partly adopted** (`tagConflict`, unique tags); plant merge **deferred** |
| 18 | Archive-with-cause instead of delete — status, date, cause; one tap inside the walk | cheap | Penn State *"Deaccessioned records are not deleted"*; WI DNR condition "dead" (https://dnr.wisconsin.gov/topic/urbanforests/inventoryattributes) | **Deferred** |
| 19 | Zone-level treatment log with the real record fields and "mark zone treated" — closes the loop with the deterministic trend | cheap | USDA applicator recordkeeping (https://ipm-cahnr.media.uconn.edu/wp-content/uploads/sites/3216/2022/12/RecordkeepingPrivateApplicators.pdf); Penn State Chemical Application Form | **Deferred** |
| 20 | Thermal- and battery-aware analysis queue that survives restart | native-dep (thermal listener) / moderate (restart) | https://developer.android.com/games/optimize/adpf/thermal | **Restart survival adopted** (reconcile, "struggling" stop after two timeouts); thermal listener **deferred** — no native dep |
| 21 | Decode Data Matrix / Code 128 alongside QR; torch toggle and tilt hint on the scan screen | moderate | herBAR (Code 39); asset-roll compatibility | **Deferred** (QR only in v1; `@zxing/library` priced for Phase 7) |
| 22 | Printable tag sheet export — optional, after the codes exist | moderate | additem.to; Avery 5160; Denso EC level | **Deferred** (Phase 7 export at most; deliberately not built in-app) |

Nothing adopted requires a new native dependency; the two new dependencies (`jsqr`, `jpeg-js`) are pure JavaScript.

## 7. What would change the recommendation

- **If the pure-JS decode fails on real garden photos.** This is the governing risk and three of the five sweeps flag
  it: nobody has measured whether a ~25–40 mm tag decodes from a real phone photo of a stake. It is no longer a
  `scanFromURLAsync` spike — it is `jsqr` on `jpeg-js` pixels at 800 px, and the Phase 0 device probe (hit rate at
  ≥ 50 % / 15 % / 5 % of the frame) is exactly that test. If it fails, the separator shot dies and Garden Walk falls
  back to typed number + walk order + sticky chip; everything else survives unchanged.
- **Two Expo issues the research leaned on no longer apply.** expo/expo#44491 is an iOS/CocoaPods bug in SDK 55
  (`ExpoCamera.podspec` and ZXingObjC), not an Android gradle property, and ML Kit is stripped from this APK anyway
  (https://github.com/expo/expo/issues/44491); expo/expo#23699 concerns `expo-camera`'s own QR scanning, which F39
  does not use (https://github.com/expo/expo/issues/23699). Dogfooding the pure-JS path on the oldest Android device
  still stands as advice.
- **If real users have ≤ 10 trees**, zones and walk order are waste — the sticky chip plus a picker is sufficient. The
  30–200 range came from the brief, not from evidence about Citrus Care's users.
- **If they have 500+ or commercial rows**, row/block structure becomes mandatory and CSV *import* (seeding plants from
  an existing spreadsheet) jumps above most of §6 — the governing grower risk is *"a lot of work to re-enter data"*.
- **If `expo-image-picker` 57 uses the legacy picker by default on Android**, EXIF behaviour changes — test on-device,
  because the separator ordering and the time-gap suggestion silently corrupt if capture order is wrong. Always sort by
  `DateTimeOriginal` + `SubSecTimeOriginal`, never selection order.
- **If a pure-JS Code 128 / Data Matrix decoder is added** (Phase 7), foreign 1D asset rolls become scannable and the
  "buy QR, not barcodes" line in §4 softens.
- **Nothing would make GPS an identifier.** Even a perfect implementation is bounded by physics at 3–5 m spacing under
  canopy. The only conceivable use is site-level disambiguation at tens of metres, and a manually chosen zone gives that
  for zero dependencies and zero permissions.

## 8. Where the evidence is thin

Verbatim from the synthesis:

- **No measured decode rate** for a garden tag in a phone photo (the governing risk above).
- **No university extension publication on home-orchard tree labelling exists.** The home-scale evidence is arborist-commercial (Bartlett) plus forum anecdote. Every claim about what hobbyists do is anecdotal and should be read that way.
- **No controlled QR-vs-Code-128 outdoor read-rate study.** The EC-level argument rests on Denso's published spec (solid) plus vendor blogs (not).
- **The 10:1 scan-distance rule and the 10–15° anti-glare tilt** are vendor best-practice content, not standards or measured data.
- **No prior art for walk-order auto-advance or skipped-tree conventions** — searched across tree-inventory, orchard and vineyard tooling and found only manual tap-advance.
- **No app found that imports a folder of photos and distributes them across existing plants.** That's absence-of-evidence across ~20 vendor pages, not proof — but if true it is your clearest differentiator.
- **No data on time-per-tree for a home gardener.** The only figures are professional (Arnold's two-person team on a 5-year cycle; 120–200 tags/hour for installation with a purpose-built tool).
- **The pure-JS QR → HTML → `expo-sharing` print path and the tile-crop-and-upscale decode mitigation are unprototyped engineering inferences.**
- Bartlett and National Band **directly conflict** on whether tag springs help; Bartlett (independent) says no. Bartlett prefers brass over aluminium because squirrels strip aluminium tags — a single-source anecdote from one US consultancy.

Also thin, from the sweeps: NFC read-range figures are tag-vendor listings, not datasheets; Amazon and Plantsoon
small-tag prices, National Band per-unit pricing and Avery UltraDuty specifications could not be read; the Chicago
Botanic Garden tip, the IrisBG QR article and the OrcharDex / Orchard Diary listings were search snippets only; and
whether `expo-image-picker` 57 defaults to the system Photo Picker is undocumented.

**Corrections applied** (from the source check; each is fixed in the body above):

1. **ISA quote scoping** — restored the full sentence *"…that cannot easily be linked to some permanent reference object"* and stated that ISA scopes the marker recommendation to randomly distributed trees, not to all methods (§2).
2. **Bartlett's mounting advice** — replaced "chest height on the side you walk from" with Bartlett's actual guidance, about six feet on the least visible side; our ergonomic preference is now labelled an unsourced inference (§5).
3. **Bartlett's own 1 m GPS claim** — added as a caveat: the tag-plus-GPS paragraph calls GPS accurate within 1 m, so Bartlett is not an authority for GPS inaccuracy (§2, §3).
4. **Arnold's two labels** — the manual's reason is accessibility and conspicuous placement on trees with low-hanging branches, not redundancy; larger trees without low branches get one trunk label (§2, §5).
5. **"200 labels for $114–$300"** — removed; WePrintBarcodes sells in increments of 1,000 ($168.37–$394.61 polyester, high-tack from $239.94) and MyAssetTag's minimum is 100 from $249.95 — no vendor sells 200 (§3, §4).
6. **Android Photo Picker EXIF-location redaction and the August 2026 opt-in API** — attributed only to Android Authority, a news blog; the cited official media page covers `ACCESS_MEDIA_LOCATION` / `setRequireOriginal()` for MediaStore, and neither official page mentions the picker's EXIF handling (§3).
7. **expo/expo#44491** — an iOS/CocoaPods issue in SDK 55 with no Android gradle property in it; the "check your build" advice is dropped and the issue is moot with ML Kit removed (§7).
8. **Tree-SLAM 20 %** — the figure is the paper's achieved result (18 cm, less than 20 % of planting distance), not a threshold; its per-tree matching criterion is half the planting distance, i.e. 1.5–2.5 m at 3–5 m spacing, not 0.6–1.0 m (§3).
9. **EC level H 30 %** — attributed to ISO/IEC 18004; the Denso page's text confirms Q/H for dirty environments and M as most common but gives 30 % only inside an image (§3, §5).
10. **Gardenize's cap** — a per-upload limit on the paid Plus tier with unlimited total photos; the free tier is one picture per plant (§2).
11. **ML Kit / `scanFromURLAsync` framing** — every decode-limit statement is re-framed for the pure-JS decoder chosen on 2026-09-19; the underlying quotes (Expo, ML Kit, gps.gov, PLOS ONE, RBGE, USFS/MSU, Bartlett, Gemplers, National Band, MyAssetTag, WePrintBarcodes, nfc-manager, i-Tree, Hectre, TreePlotter, Arnold) were confirmed verbatim and stand.
12. **Sourcing hygiene** — recorded that the ISA BMP and Bartlett PDFs are image scans verified by manual reading (§1).

## 9. Sources

**Arboriculture, arboreta and public gardens**
http://unri.org/ECO%20697U%20S14/Tree%20Inventories%20BMP-ISA%202.pdf
https://www.bartlett.com/dynamic/pdf/technical-reports/tree-tagging-faqs-inventory-identification.pdf
https://arboretum.harvard.edu/wp-content/uploads/2020/07/plant_inventory_operations_manual.pdf
https://arboretum.harvard.edu/arnoldia-stories/records-label-creation-and-deployment
https://www.publicgardens.org/wp-content/uploads/2018/03/plant-records-manual-outline11072017.pdf
https://libguides.nybg.org/c.php?g=824991
https://www.botanic.cam.ac.uk/the-garden/understanding-plant-labels/
https://www.missouribotanicalgarden.org/gardens-gardening/our-garden/plant-records
https://www.hortis.com/blog/what-is-accessioning
https://support.hortis.com/support/solutions/articles/80001151982-print-plant-labels
https://www.uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/design-guidelines/tree-numbering-and-reporting-guidelines-05.2025.pdf
https://blogs.cornell.edu/urbanhort/outreach/community-forestry/conducting-a-street-tree-inventory/
https://auf.isa-arbor.com/content/24/3/135

**Government, extension and inventory standards**
https://repository.library.noaa.gov/view/noaa/41260/noaa_41260_DS1.pdf
https://www.itreetools.org/resources/manuals/Ecov6_ManualsGuides/Ecov6Guide_InventoryImporter.pdf
https://dnr.wisconsin.gov/topic/urbanforests/inventoryattributes
https://ipm-cahnr.media.uconn.edu/wp-content/uploads/sites/3216/2022/12/RecordkeepingPrivateApplicators.pdf
https://ucanr.edu/blog/under-solano-sun/article/helpful-support-or-leftover-packaging-truth-about-nursery-stakes-ties
https://intermountainfruit.org/ipm-methods/monitoring
https://ask.extension.org/kb/faq.php?id=845716
https://www.gps.gov/gps-accuracy

**Orchards and herbaria**
https://ptes.org/campaigns/traditional-orchard-project/orchard-practical-guides/mapping-your-orchard/
https://montezumaorchard.org/document-your-old-orchard/
https://dissco.github.io/HerbariumSheets/RBGEHerbariumSheet.html
https://github.com/BRITorg/herBAR

**Peer-reviewed and preprint**
https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0283090
https://pmc.ncbi.nlm.nih.gov/articles/PMC8838512/
https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2016.01342/full
https://arxiv.org/html/2507.12093

**Platform documentation and issue trackers**
https://developers.google.com/ml-kit/terms
https://developers.google.com/ml-kit/vision/barcode-scanning/android
https://docs.expo.dev/versions/latest/sdk/camera/
https://docs.expo.dev/versions/latest/sdk/imagepicker/
https://docs.expo.dev/versions/latest/sdk/print/
https://developer.android.com/training/data-storage/shared/photopicker
https://developer.android.com/training/data-storage/shared/media
https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface
https://developer.android.com/games/optimize/adpf/thermal
https://developer.android.com/training/data-storage
https://github.com/expo/expo/issues/44491
https://github.com/expo/expo/issues/23699
https://github.com/revtel/react-native-nfc-manager/wiki/Expo-Go
https://www.androidauthority.com/android-photo-picker-location-sharing-release-3704689/

**Field-software and app vendors**
https://support.treeplotter.com/knowledge-base/tutorial-photos/
https://support.treeplotter.com/knowledge-base/sharing-data-with-qr-codes/
https://support.treeplotter.com/knowledge-base/geolocation/
https://hectre.helpscoutdocs.com/article/135-add-orchards-blocks-sub-blocks
https://viniferavineyardmanagement.com/features/scouting
https://doc.arcgis.com/en/arcgis-solutions/11.3/reference/use-tree-management.htm
https://www.esri.com/arcgis-blog/products/survey123/announcements/barcode-scanning-in-survey123-for-arcgis
https://www.fulcrumapp.com/blog/barcode-qr-code-scanning-2/
https://vineline.eu/
https://gardenos.app/
https://www.plntrk.com/
https://acemaker.qrlog.app/
https://www.latschbacher.com/en/tagging-technology/signumat-urban-forest-line/
https://apps.apple.com/us/app/gardenize-plant-care-journal/id1118448120
https://gardenize.com/faq-gardenize/
https://getplanta.com/article/progressevent
https://www.seedtospoon.net/app/
https://docs.plantnet.org/en/tutorials/identify-a-plant/
https://leaftide.com/compare/best-orchard-tracking-app/
https://forum.inaturalist.org/t/standard-qr-codes-for-plant-and-tree-species/42702

**Tags, labels and codes — vendors and standards bodies**
https://www.qrcode.com/en/about/error_correction.html
https://www.qrcode.com/en/howto/code.html
https://gemplers.com/products/round-numbered-aluminum-tree-tags
https://www.treestuff.com/round-aluminum-tree-tags/
https://www.nationalband.com/arboretum-tags/
https://identificationtags.com/engraved-tree-tags/
https://www.myassettag.com/qr-asset-tags
https://www.myassettag.com/preprinted-barcode/in-stock-barcode-labels
https://weprintbarcodes.com/qr-code-labels.html
https://plantsoon.com/en/plantsigns
https://www.tagstand.com/products/outdoor-type-2-nfc-sticker-ntag213-on-metal-circle-35mm-1/
https://nfcntag.com/custom-nfc-tags/custom-rfid-nail-tags/
https://paladinid.com/what-causes-label-adhesive-failure/
https://commonlands.com/blogs/technical/barcode-reading-machine-vision
https://additem.to/guides/print-qr-barcode-labels
https://www.avery.com/category/usage/qr-code-labels/

**Hobbyist forums (anecdotal)**
https://permies.com/t/135517/label-fruit-trees
https://forums.homeorchardsociety.org/discuss/general-forum/permanent-labels-buy-or-make/
https://growingfruit.org/t/orchard-mapping/2770
https://growingfruit.org/t/basic-orchard-software/26000
https://growingfruit.org/t/tagging-what-do-you-do/22170
