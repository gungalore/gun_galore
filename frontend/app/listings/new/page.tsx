'use client';

import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Category, CategoryAttributeDef, Me, ExperienceType } from '@/lib/types';
import { CONDITION_LABELS, EXPERIENCE_TYPE_LABELS, PROVINCE_LABELS } from '@/lib/utils';
import { CategoryPicker } from '@/components/category-picker';
import { PillGroup, MultiSelectPillGroup } from '@/components/pill';
import { PhotoDropzone } from '@/components/photo-dropzone';
import { StepAccordion, StepStatus } from '@/components/step-accordion';
import IdentifyFromPhotos from './identify-from-photos';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from '@/components/address-autocomplete';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
// NOTE: LockerPicker is intentionally NOT used on the Sell form. The
// seller drops at ANY Pudo locker using a delivery PIN — there's no
// need for them to pre-select a drop-off locker here. The picker lives
// in the buyer-side checkout flow where the destination locker matters.
import type { ShippingMethod } from '@/lib/types';
import {
  ListingPreviewModal,
  PreviewResult,
  PreviewSnapshot,
} from '@/components/listing-preview-modal';
import {
  ProfileCompletionModal,
  shouldSuppressProfileModal,
} from '@/components/profile-completion-modal';
import { HelpTip } from '@/components/help-tip';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─────────────────────────── Fee math ───────────────────────────────
// Client-side mirror of backend/src/payments/fee.calculator.ts so we can
// show the seller a live "you receive" preview without round-tripping
// to the API on every keystroke. Keep this in sync with the BANDS +
// MIN_COMMISSION_CENTS constants on the backend.

const COMMISSION_BANDS: { limit: number; rate: number; label: string }[] = [
  { limit: 500_000, rate: 0.09, label: 'First R5,000 at 9%' },
  { limit: 1_500_000, rate: 0.07, label: 'R5,001–R20,000 at 7%' },
  { limit: 8_000_000, rate: 0.05, label: 'R20,001–R100,000 at 5%' },
  { limit: Infinity, rate: 0.03, label: 'Above R100,000 at 3%' },
];
const MIN_COMMISSION_CENTS = 3_000; // R30 floor — see backend fee.calculator.ts

// The three ways to list — rendered as descriptive choice cards in Step 3
// so sellers can compare and know where to list before picking. Copy mirrors
// the /how-selling-works help page.
const SELL_MODES: {
  value: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';
  name: string;
  tagline: string;
  bestFor: string[];
}[] = [
  {
    value: 'BUY_NOW',
    name: 'Marketplace',
    tagline: 'Fixed price — the fastest, cleanest sale.',
    bestFor: ['Known market price', 'Sell it now', 'Multiple identical units'],
  },
  {
    value: 'AUCTION',
    name: 'Auction',
    tagline: 'Let buyers compete and bid it up.',
    bestFor: ['Rare or in-demand', 'Unsure how high it’ll go', 'Hidden reserve protects you'],
  },
  {
    value: 'TAKE_A_SHOT',
    name: 'Take a Shot',
    tagline: 'Buyers make offers; you decide.',
    bestFor: ['Hard to price', 'Open to offers', 'Optional instant auto-accept'],
  },
  {
    value: 'SWOP',
    name: 'Swop / Trade',
    tagline: 'Trade your gear for theirs — add cash if needed.',
    bestFor: ['Upgrading your kit', 'No cash to spare', 'Item-for-item, ± a top-up'],
  },
];

// Common SA plains-game species for the PLAINS_GAME_HUNT multi-select.
// The seller ticks whatever the package includes; sent as speciesList[].
const SPECIES_OPTIONS = [
  'Impala',
  'Blesbok',
  'Kudu',
  'Gemsbok (Oryx)',
  'Springbok',
  'Warthog',
  'Zebra',
  'Wildebeest',
  'Nyala',
  'Waterbuck',
  'Red Hartebeest',
  'Eland',
  'Bushbuck',
  'Duiker',
] as const;

function calcCommissionCents(priceCents: number): number {
  let commission = 0;
  let remaining = priceCents;
  for (const band of COMMISSION_BANDS) {
    if (remaining <= 0) break;
    const chunk = isFinite(band.limit)
      ? Math.min(remaining, band.limit)
      : remaining;
    commission += chunk * band.rate;
    remaining -= chunk;
  }
  const rounded = Math.max(0, Math.round(commission));
  // R30 minimum platform fee — surfaced in PriceBreakdown so the seller
  // knows up-front. Floor never exceeds the price itself.
  if (priceCents > 0 && rounded < MIN_COMMISSION_CENTS) {
    return Math.min(MIN_COMMISSION_CENTS, priceCents);
  }
  return rounded;
}

// Note: the buyer's payment-processing fee (Peach: 3.5% + R1.50) is
// added to their checkout total and kept by the platform — the seller
// never sees it, so the Sell form intentionally doesn't compute it here.

function formatRand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─────────────────────────── Shared styles ───────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
};

// ─────────────────────────── Field wrapper ───────────────────────────

function Field({
  label,
  hint,
  tip,
  tipTitle,
  required,
  children,
}: {
  label: string;
  hint?: string;
  // Optional ⓘ explainer next to the label for jargon-y fields
  // (Reserve, Proxy bid, Auto-accept). Hover-on-desktop, tap-to-lock
  // on touch.
  tip?: React.ReactNode;
  tipTitle?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-xs mb-2"
        style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {label}
          {required && (
            <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>
          )}
          {tip && (
            <HelpTip title={tipTitle ?? label} side="right">
              {tip}
            </HelpTip>
          )}
        </span>
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// Compact number input used by the parcel weight + dimensions grid in
// step 3. Accepts digits + a single decimal point (whole + tenth-of-a-cm
// is enough precision for box-fit calcs). Empty string is a valid state
// while the seller is typing.
function SmallNumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span
        className="block text-xs mb-1"
        style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) =>
          onChange(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))
        }
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 13,
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
    </label>
  );
}

// ─────────────────── Per-category attribute field (P4.2) ────────────
// Renders one input per CategoryAttributeDef in the "About this item"
// step's Specifications sub-section. Value is held as a string (NUMBER /
// SELECT / TEXT) or boolean (BOOLEAN) in the parent's attrValues map;
// coercion to the payload shape happens in collectedAttributes.
function AttributeField({
  def,
  value,
  onChange,
}: {
  def: CategoryAttributeDef;
  value: string | boolean | undefined;
  onChange: (next: string | boolean) => void;
}) {
  // BOOLEAN → a checkbox whose label is the attribute label. Matches the
  // "Offer Buy Now" checkbox styling used elsewhere in this form.
  if (def.type === 'BOOLEAN') {
    return (
      <label
        className="flex items-start gap-2 cursor-pointer"
        style={{ color: 'var(--text-secondary)' }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: 'var(--red)', marginTop: 3 }}
        />
        <span className="text-sm" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {def.label}
          {def.required && (
            <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>
          )}
        </span>
      </label>
    );
  }

  const strValue = typeof value === 'string' ? value : '';

  return (
    <Field
      label={def.label}
      required={def.required}
      hint={def.unit ? `In ${def.unit}.` : undefined}
    >
      {def.type === 'SELECT' ? (
        <select
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          <option value="">Select…</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : def.type === 'NUMBER' ? (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            inputMode="decimal"
            value={strValue}
            onChange={(e) =>
              onChange(
                e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'),
              )
            }
            style={{ ...inputStyle, paddingRight: def.unit ? 48 : 12 }}
            placeholder="0"
          />
          {def.unit && (
            <span
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              {def.unit}
            </span>
          )}
        </div>
      ) : (
        // TEXT
        <input
          type="text"
          maxLength={200}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )}
    </Field>
  );
}

// ─────────────────────────── Page ───────────────────────────────────

export default function NewListingPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  // DG lithium-Wh courier limit, mirrored from the server so this form's
  // "becomes collection-only" notice matches the server's actual gate even
  // after an admin retunes it. Defaults to 100 (the standard UN3480 limit)
  // until the config fetch resolves; a failed fetch just leaves 100.
  const [dgWhThreshold, setDgWhThreshold] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);

  // Description AI state — preview-box pattern (lifted from the old
  // project). When `suggestion` is non-null we render a "Suggested
  // description" box below the textarea with Use / Keep original buttons.
  // We do NOT auto-replace the seller's text — they have to opt in.
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // Resale-value estimator (RVE) — button-triggered "Suggest a price" that
  // returns an INDICATIVE range from recent sales / typical retail. Button, not
  // auto-fetch, so it only spends an AI/web-search call on explicit seller intent.
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{
    available: boolean;
    low?: number;
    high?: number;
    midpoint?: number;
    confidence?: 'low' | 'medium' | 'high';
    note?: string;
    disclaimer: string;
  } | null>(null);

  // Preview / soft-block moderation flow.
  // `previewResult` drives the modal display; null = modal closed.
  // `auditResult` holds the latest moderation pass result — updated
  // whenever the seller advances past Step 1 OR changes their photos.
  // When the seller clicks Preview, we open the modal pointed at the
  // cached auditResult instead of running another audit (saves a round
  // trip and gives them instant feedback).
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [auditResult, setAuditResult] = useState<PreviewResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [previousAttemptHashes, setPreviousAttemptHashes] = useState<string[]>([]);

  // Delivery + pickup-address state. Lives outside `form` because the
  // shipping-methods array doesn't fit the flat string-map.
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  // Phase M dealer-lock — optional hint of where the seller intends
  // to dealer-stock this firearm. Only collected + sent when isFirearm.
  // Buyers near that dealer see it on listing detail.
  const [plannedDealerLocation, setPlannedDealerLocation] = useState('');
  // Collection-only papers attestation — required for requiresPapers
  // categories (trailers / caravans). Seller confirms they hold valid
  // registration + roadworthy papers and will hand them over at
  // collection. Checkbox-only (POPIA — no documents collected); sent as
  // collectionPapersAttested and gated into the publish flow below.
  const [papersAttested, setPapersAttested] = useState(false);
  // P5.4 — optional "tested & working" seller claim (electronics/appliances).
  const [testedWorkingAttested, setTestedWorkingAttested] = useState(false);
  // Firearm compliance capture — serial number + two photos (the serial
  // stamping and the seller's licence). Only collected + sent when
  // isFirearm. The backend runs Claude vision on these and BLOCKs the
  // create (HTTP 400 with a message) on serial/holder mismatch, an
  // unreadable photo, or a licence within 30 days of expiry. The two
  // File objects are deliberately NOT persisted to the localStorage
  // draft (same reasoning as the listing photos — File can't serialise).
  const [serialNumber, setSerialNumber] = useState('');
  const [serialPhoto, setSerialPhoto] = useState<File | null>(null);
  const [licencePhoto, setLicencePhoto] = useState<File | null>(null);

  // ── Hunting Packages / Experiences (Phase E) ──────────────────────────
  // Collected + sent only when the selected category is an experience. An
  // experience is a future-dated on-site SERVICE (no courier/parcel): the
  // seller captures the event window, venue, capacity, package type, and —
  // for a plains-game hunt — the species on offer. The supplier compliance
  // block below reuses the firearm File-state + upload pattern for the two
  // Cloudinary docs (PLI cert + registration doc) and gates three
  // mandatory attestations. None of this is persisted to the localStorage
  // draft (File objects don't serialise; the rest is category-scoped).
  const [exp, setExp] = useState({
    experienceType: 'RANGE_DAY' as ExperienceType,
    eventStartDate: '', // yyyy-mm-dd
    eventEndDate: '', // optional yyyy-mm-dd (multi-day window)
    eventProvince: '', // Province enum key
    locationText: '',
    capacitySlots: '',
    durationText: '',
    whatsIncluded: '',
    rifleProvided: false,
  });
  // Species multi-select (PLAINS_GAME_HUNT only). Held as a string[] of the
  // common SA plains-game species the seller ticked.
  const [species, setSpecies] = useState<string[]>([]);
  // Supplier & compliance capture. Registration number + two docs + three
  // attestations. Docs upload to /listings/experience-supplier-docs (same
  // FormData pattern as firearm-docs) BEFORE the create call.
  const [supplierRegNumber, setSupplierRegNumber] = useState('');
  const [supplierInsuranceDoc, setSupplierInsuranceDoc] = useState<File | null>(
    null,
  );
  const [supplierRegDoc, setSupplierRegDoc] = useState<File | null>(null);
  const [supplierPliAttested, setSupplierPliAttested] = useState(false);
  const [supplierAuthorityAttested, setSupplierAuthorityAttested] =
    useState(false);
  const [supplierRiskAttested, setSupplierRiskAttested] = useState(false);
  const [pickupAddress, setPickupAddress] = useState<ManualAddressValue>(
    emptyManualAddress,
  );
  // Coordinates come from Google Places autocomplete. We persist them on
  // the listing so the buyer-side checkout can compute distance to the
  // chosen Pudo destination locker. Null when the seller typed manually
  // instead of picking a Google suggestion.
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);

  // Parcel weight + dimensions. Required for non-firearm listings — Pudo
  // and TCG both need them to quote rates. Stored as strings here for
  // forgiving input UX, parsed to numbers on submit. Weight in kilograms
  // (the unit a seller intuits), dimensions in centimetres (matches
  // Pudo's API). Empty for firearm listings (the courier API isn't used).
  const [parcel, setParcel] = useState({
    weightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
  });

  // Stock / quantity (Phase 8a). Only meaningful for BUY_NOW non-firearm
  // listings — a value > 1 opts the listing into inventory tracking so it
  // stays live until every unit sells. Empty / 1 = a single item (default).
  const [stock, setStock] = useState('');

  // Per-category attributes (P4.2). `attrDefs` are the definitions for the
  // currently-selected category (its own + inherited), fetched from
  // GET /categories/:id/attributes whenever the category changes. `attrValues`
  // holds the seller's raw string/boolean input keyed by def.key — coerced to
  // numbers / booleans at submit time. Both reset on a category switch (a new
  // category has a different attribute set). Categories with no defs render
  // nothing and send no `attributes`, so firearm / other categories are
  // completely unaffected.
  const [attrDefs, setAttrDefs] = useState<CategoryAttributeDef[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string | boolean>>(
    {},
  );

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    // Intentionally empty — we want the seller to consciously pick
    // Marketplace, Auction, or Take a Shot. The old default of
    // 'BUY_NOW' meant sellers who never read past the title field
    // accidentally listed everything as fixed-price even when an
    // auction would have made them more. Step 2 now blocks until
    // a type is chosen.
    listingType: '',
    categoryId: '',
    condition: 'GOOD',
    province: 'GAUTENG',
    // Buyer always pays the payment-processing fee — it's added to their
    // total at checkout, and we keep it. The seller never sees this fee
    // anywhere in the UI. Hardcoded so the API receives the right flag.
    passFeeToBuyer: true,
    autoAcceptThreshold: '',
    durationDays: '7',
    reservePrice: '',
    // Buy Now is opt-in. The checkbox below toggles whether the price
    // input is visible AND whether the value is submitted — turning it
    // off mid-form blanks the price so a stale value can't leak through.
    offerBuyNow: false,
    buyNowPrice: '',
  });

  // ─── Draft persistence ──────────────────────────────────────────
  // Multi-step accordion + photo upload + Claude moderation = the
  // form is a long-haul commitment for sellers. Without this an
  // accidental refresh wipes everything (which actually happens —
  // photo-upload failures auto-delete the listing, the seller is
  // then stuck retyping the description). Save everything except
  // photos (File objects don't serialize) to localStorage on every
  // change; restore on mount; clear on successful publish.
  const draftKey = 'gg-listing-new-draft';
  const [draftRestored, setDraftRestored] = useState(false);

  // Relist prefill — one-shot. The 'Relist' CTA on /my/listings routes here
  // with ?relistFrom=<sourceListingId>. Fetch that listing (public detail
  // endpoint) and seed the text fields so the seller doesn't retype title,
  // description, category + attributes. Photos are File objects and can't be
  // carried over — the seller re-uploads them (the form already requires
  // that). Price/reserve are seeded from the source; the seller can lower
  // them (the NO_BIDS/NO_RESERVE copy tells them to). We gate on an empty
  // draft so a live draft-restore always wins and a relist never clobbers a
  // half-finished listing.
  const searchParams = useSearchParams();
  const relistFromId = searchParams.get('relistFrom');
  const relistDoneRef = useRef(false);
  useEffect(() => {
    if (relistDoneRef.current || !relistFromId) return;
    relistDoneRef.current = true;
    if (typeof window !== 'undefined' && localStorage.getItem(draftKey)) {
      // A saved draft takes precedence — never overwrite in-progress work.
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/listings/${relistFromId}`);
        if (!res.ok) return;
        const l = (await res.json()) as {
          title?: string;
          description?: string;
          categoryId?: string;
          condition?: string;
          province?: string;
          price?: number; // cents
          reservePrice?: number | null; // cents
          attributes?: Record<string, string | boolean> | null;
        };
        setForm((f) => ({
          ...f,
          title: l.title ?? f.title,
          description: l.description ?? f.description,
          categoryId: l.categoryId ?? f.categoryId,
          condition: l.condition ?? f.condition,
          province: l.province ?? f.province,
          // Rand strings for the inputs (state stores rand, submit multiplies).
          price: l.price != null ? String(l.price / 100) : f.price,
          reservePrice:
            l.reservePrice != null
              ? String(l.reservePrice / 100)
              : f.reservePrice,
        }));
        if (l.attributes && typeof l.attributes === 'object') {
          setAttrValues((prev) => ({ ...prev, ...l.attributes! }));
        }
      } catch {
        // Source gone / network — fall through to a blank form.
      }
    })();
  }, [relistFromId]);

  // Restore on mount (one-shot ref so a re-render doesn't loop).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        form?: typeof form;
        parcel?: typeof parcel;
        pickupAddress?: ManualAddressValue;
        pickupLat?: number | null;
        pickupLng?: number | null;
        // Phase M dealer-lock — persist shipping picks + the
        // optional planned-dealer hint so a PWA reload doesn't
        // make the seller re-do them.
        shippingMethods?: ShippingMethod[];
        plannedDealerLocation?: string;
      };
      if (d.form) setForm(d.form);
      if (d.parcel) setParcel(d.parcel);
      if (d.pickupAddress) setPickupAddress(d.pickupAddress);
      if (d.pickupLat !== undefined) setPickupLat(d.pickupLat);
      if (d.pickupLng !== undefined) setPickupLng(d.pickupLng);
      if (d.shippingMethods) setShippingMethods(d.shippingMethods);
      if (d.plannedDealerLocation !== undefined) {
        setPlannedDealerLocation(d.plannedDealerLocation);
      }
      setDraftRestored(true);
    } catch {
      // Bad JSON / quota — ignore, start fresh.
    }
  }, []);

  // Save on every change. Excludes photos (File[]) — those can't be
  // serialised; the seller has to re-select on resume. The "draft
  // restored" notice tells them this.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          form,
          parcel,
          pickupAddress,
          pickupLat,
          pickupLng,
          shippingMethods,
          plannedDealerLocation,
        }),
      );
    } catch {
      // Quota / private mode — silent.
    }
  }, [
    form,
    parcel,
    pickupAddress,
    pickupLat,
    pickupLng,
    shippingMethods,
    plannedDealerLocation,
  ]);

  // Discard the draft (lets the seller force a clean slate).
  function discardDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setDraftRestored(false);
    window.location.reload();
  }

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setCategories(data as Category[]);
      })
      .catch(() => {});
  }, []);

  // Mirror the admin-tunable DG lithium-Wh limit so the sell-form notice can't
  // drift from the server gate. One-shot on mount; fail-open leaves the 100 Wh
  // default (which also matches the server's fail-open default).
  useEffect(() => {
    fetch(`${API_URL}/listings/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const n = (data as { dgLithiumWhThreshold?: number } | null)
          ?.dgLithiumWhThreshold;
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
          setDgWhThreshold(n);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/sign-in');
    }
  }, [isLoaded, isSignedIn, router]);

  // Prefill pickup address from the seller's saved profile address —
  // they already typed it on /profile/edit (or during checkout), no
  // reason to make them retype on every new listing. They can still
  // edit the ManualAddressFields below if they want a different pickup
  // point (e.g. a friend's place, an office). We only prefill if the
  // user has BOTH an address AND coords saved (coords are needed for
  // the rate / nearest-locker maths). One-shot on mount.
  const prefilledRef = useRef(false);
  // Full /users/me snapshot held client-side so we can check
  // profileCompletedAt at publish time (decides whether to pop the
  // ProfileCompletionModal before redirecting to the listing).
  const [currentMe, setCurrentMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const me = (await res.json()) as Me;
        if (cancelled) return;
        setCurrentMe(me);
        // Phase 6 P6.3 — pre-fill parcel dims from the seller's saved
        // defaults, but only fields the seller (or a restored draft) hasn't
        // already filled, so we never clobber their input.
        setParcel((p) => ({
          weightKg: p.weightKg || (me.defaultWeightGrams ? String(me.defaultWeightGrams / 1000) : ''),
          lengthCm: p.lengthCm || (me.defaultLengthCm ? String(me.defaultLengthCm) : ''),
          widthCm: p.widthCm || (me.defaultWidthCm ? String(me.defaultWidthCm) : ''),
          heightCm: p.heightCm || (me.defaultHeightCm ? String(me.defaultHeightCm) : ''),
        }));
        if (prefilledRef.current) return;
        if (!me.addrStreet || me.addrLat == null || me.addrLng == null) {
          // No saved address yet — leave the form blank, seller fills
          // it from scratch. Profile/edit will save it next time.
          return;
        }
        setPickupAddress({
          building: me.addrBuilding ?? '',
          street: me.addrStreet ?? '',
          address2: me.addrAddress2 ?? '',
          suburb: me.addrSuburb ?? '',
          city: me.addrCity ?? '',
          postalCode: me.addrPostalCode ?? '',
          province: me.addrProvince ?? '',
        });
        setPickupLat(me.addrLat);
        setPickupLng(me.addrLng);
        // Sync the listing's province to the seller's profile province.
        // Without this the form kept its hard-coded GAUTENG default and
        // published listings showed the wrong province even when the
        // seller's address was clearly in another province.
        if (me.addrProvince) {
          setForm((f) => ({ ...f, province: me.addrProvince! }));
        }
        prefilledRef.current = true;
      } catch {
        // Non-fatal — seller can still fill the form manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Modal state — set when a listing publish succeeded AND the seller
  // hasn't completed their profile yet. The router.push is deferred
  // until they finish the modal.
  const [pendingRedirectId, setPendingRedirectId] = useState<string | null>(
    null,
  );

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const isFirearm = selectedCategory?.isFirearm ?? false;
  // Collection-only (trailers / caravans) — the item is collected in
  // person from the seller, so we hide the courier picker + parcel
  // inputs and force shippingMethods to ['COLLECTION'] (see the effect
  // mirroring the firearm one below).
  const collectionOnly = selectedCategory?.collectionOnly ?? false;
  // Requires a papers attestation before publish (NaTIS registration +
  // roadworthy). Drives the required checkbox in the Delivery step.
  const requiresPapers = selectedCategory?.requiresPapers ?? false;
  const showTestedWorking =
    selectedCategory?.showTestedWorkingAttestation ?? false;
  // Hunting Packages / Experiences (Phase E) — the selected category is an
  // experience. Mirrors the isFirearm / collectionOnly snapshot-flag
  // derivations: when true we restrict the selling modes to BUY_NOW /
  // AUCTION, hide the whole courier/parcel + delivery-method UI (like
  // effectiveCollectionOnly), and surface the Experience-details +
  // Supplier-compliance sections in the final step.
  const isExperience = selectedCategory?.isExperience ?? false;
  // Only a plains-game hunt collects a species list; a range day doesn't.
  const isPlainsGameHunt =
    isExperience && exp.experienceType === 'PLAINS_GAME_HUNT';

  // P4.3b — dangerous-goods gate (transparency mirror). A LOOSE lithium
  // battery rated above the courier limit (UN3480) can't be couriered, so the
  // backend FORCES such a listing to collection-only. We recompute the same
  // flag here purely so the sell form isn't silent about it — the seller sees
  // why the courier options disappear as they type the value. The threshold
  // is fetched from GET /listings/config (dgWhThreshold state) so it tracks
  // the admin-tunable server limit instead of a drifting hardcoded 100.
  // True only when the current category actually defines a `battery_wh`
  // NUMBER attribute AND the seller's entered value coerces to a finite
  // number strictly greater than the threshold. A blank / non-numeric value,
  // or a category with no battery_wh def, keeps this false — so categories
  // without the attribute behave byte-identically to before. Recomputes
  // reactively as attrDefs (category change), attrValues (typing), or the
  // fetched threshold change.
  const dgLithiumRestricted = useMemo(() => {
    const hasBatteryWhDef = attrDefs.some((d) => d.key === 'battery_wh');
    if (!hasBatteryWhDef) return false;
    const raw = attrValues['battery_wh'];
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > dgWhThreshold;
  }, [attrDefs, attrValues, dgWhThreshold]);

  // Every shipping / selling-mode gate below keys on this rather than
  // collectionOnly, so a DG-restricted battery is treated exactly like a
  // genuinely collection-only category (trailers). The papers attestation
  // stays on requiresPapers — batteries don't need registration papers.
  const effectiveCollectionOnly = collectionOnly || dgLithiumRestricted;

  // Fetch the per-category attribute definitions whenever the selected
  // category changes. Race-guarded: a fast-clicking seller can fire several
  // category switches before earlier responses land, so we tag each fetch
  // with the category id it was for and only apply the response if it still
  // matches the current selection (and the effect hasn't been cleaned up).
  // On every category change we clear the collected values — a new category
  // has a different attribute set, so keeping old values would leak stale
  // keys (the backend drops unknown keys anyway, but no point sending them).
  useEffect(() => {
    const categoryId = form.categoryId;
    // No category picked yet — clear any prior defs/values.
    if (!categoryId) {
      setAttrDefs([]);
      setAttrValues({});
      return;
    }
    let cancelled = false;
    // Clear stale values immediately so the previous category's inputs don't
    // flash while the new defs load.
    setAttrValues({});
    setAttrDefs([]);
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/categories/${categoryId}/attributes`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data: unknown = await res.json();
        // Ignore a stale response — the seller switched category again
        // before this one landed.
        if (cancelled) return;
        if (Array.isArray(data)) {
          setAttrDefs(
            (data as CategoryAttributeDef[]).filter((d) => d.isActive),
          );
        }
      } catch {
        // Non-fatal — leave the section empty. Required-attribute gating
        // only applies to defs we actually loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.categoryId]);

  // Coerce the raw attribute inputs into the payload the backend expects:
  //   NUMBER  → number (blank / non-numeric omitted)
  //   SELECT  → the chosen option string (blank omitted)
  //   TEXT    → trimmed string (blank omitted)
  //   BOOLEAN → true / false (always sent so the seller can record "No")
  // Only keys with a non-empty value survive, so empty categories send {}.
  const collectedAttributes = useMemo(() => {
    const out: Record<string, string | number | boolean> = {};
    for (const def of attrDefs) {
      const raw = attrValues[def.key];
      if (def.type === 'BOOLEAN') {
        out[def.key] = raw === true;
        continue;
      }
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (def.type === 'NUMBER') {
        const n = Number(trimmed);
        if (Number.isFinite(n)) out[def.key] = n;
        continue;
      }
      // SELECT + TEXT — send the string as-is.
      out[def.key] = trimmed;
    }
    return out;
  }, [attrDefs, attrValues]);

  // Required-attribute gate. A required NUMBER/SELECT/TEXT must have a
  // non-empty value; a required BOOLEAN is satisfied by an explicit tick
  // (unticked = "No" is not a positive confirmation, so we require it on).
  const missingRequiredAttrs = useMemo(() => {
    return attrDefs
      .filter((def) => def.required)
      .filter((def) => {
        if (def.type === 'BOOLEAN') return attrValues[def.key] !== true;
        return !(def.key in collectedAttributes);
      })
      .map((def) => def.label);
  }, [attrDefs, attrValues, collectedAttributes]);

  // Parsed parcel as numbers — null if not yet entered. Used by oversize
  // check + by buildListingPayload. Empty / NaN values stay null so the
  // step-3 completion gate refuses to advance.
  const parsedParcel = useMemo(() => {
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      weightKg: num(parcel.weightKg),
      lengthCm: num(parcel.lengthCm),
      widthCm: num(parcel.widthCm),
      heightCm: num(parcel.heightCm),
    };
  }, [parcel]);

  // Pudo's largest L2L locker box is 60 × 41 × 69 cm at 20 kg. Anything
  // beyond that physically can't ship via the locker network, so we hide
  // the PUDO pill from the seller (TCG door-to-door still works). The
  // check is orientation-agnostic — we sort parcel dims desc against the
  // sorted box max and bail if any axis overshoots.
  const PUDO_MAX_BOX_CM = [69, 60, 41] as const; // sorted desc
  const PUDO_MAX_WEIGHT_KG = 20;
  const isOversizeForPudo = useMemo(() => {
    const { weightKg, lengthCm, widthCm, heightCm } = parsedParcel;
    if (
      lengthCm == null ||
      widthCm == null ||
      heightCm == null ||
      weightKg == null
    ) {
      return false; // not enough info yet — don't lock the pill prematurely
    }
    if (weightKg > PUDO_MAX_WEIGHT_KG) return true;
    const sorted = [lengthCm, widthCm, heightCm].sort((a, b) => b - a);
    return (
      sorted[0] > PUDO_MAX_BOX_CM[0] ||
      sorted[1] > PUDO_MAX_BOX_CM[1] ||
      sorted[2] > PUDO_MAX_BOX_CM[2]
    );
  }, [parsedParcel]);

  // If the seller had PUDO selected and then types dimensions that push
  // the parcel oversize, silently drop the PUDO pick — otherwise they'd
  // sail through step 3 with an invalid combo and the buyer would hit
  // "no rate available" at checkout.
  useEffect(() => {
    if (isOversizeForPudo && shippingMethods.includes('PUDO')) {
      setShippingMethods((prev) => prev.filter((m) => m !== 'PUDO'));
    }
  }, [isOversizeForPudo, shippingMethods]);

  // The delivery-method options change when the seller switches between
  // a firearm and non-firearm category (PUDO + TCG vs DEALER_TRANSFER +
  // PRIVATE_ARRANGE). Without this reset, a prior pick from the other
  // set stays in shippingMethods and gets sent to the API alongside the
  // new picks — the server then rejects with
  // "shippingMethods must contain no more than 2 elements".
  //
  // Phase M dealer-lock — for firearms we PRE-SET DEALER_TRANSFER so it's
  // always present. The pill renders disabled-locked below so the
  // seller can't toggle it off. PRIVATE_ARRANGE remains optional.
  const lastIsFirearm = useRef(isFirearm);
  useEffect(() => {
    if (lastIsFirearm.current !== isFirearm) {
      lastIsFirearm.current = isFirearm;
      setShippingMethods(isFirearm ? ['DEALER_TRANSFER'] : []);
    }
  }, [isFirearm]);
  // Defensive: even if DEALER_TRANSFER somehow gets stripped (e.g.
  // pill-group bug, hot-reload race), force it back in for firearms.
  useEffect(() => {
    if (isFirearm && !shippingMethods.includes('DEALER_TRANSFER')) {
      setShippingMethods((prev) =>
        Array.from(new Set(['DEALER_TRANSFER', ...prev])),
      );
    }
  }, [isFirearm, shippingMethods]);

  // Collection-only categories have exactly one shipping method —
  // COLLECTION. Mirror the firearm reset: when the seller switches into
  // a collection-only category, force shippingMethods to ['COLLECTION']
  // (the courier picker + parcel inputs are hidden in the delivery step).
  // Keys on effectiveCollectionOnly (collectionOnly || dgLithiumRestricted)
  // so a DG battery whose battery_wh crosses 100 Wh forces COLLECTION the
  // same way a trailer does.
  const lastCollectionOnly = useRef(effectiveCollectionOnly);
  useEffect(() => {
    if (lastCollectionOnly.current !== effectiveCollectionOnly) {
      lastCollectionOnly.current = effectiveCollectionOnly;
      if (effectiveCollectionOnly) setShippingMethods(['COLLECTION']);
    }
  }, [effectiveCollectionOnly]);
  // Defensive: keep COLLECTION locked in for a collection-only listing
  // even if a stale pick sneaks through a hot-reload / state race.
  useEffect(() => {
    if (
      effectiveCollectionOnly &&
      (shippingMethods.length !== 1 || shippingMethods[0] !== 'COLLECTION')
    ) {
      setShippingMethods(['COLLECTION']);
    }
  }, [effectiveCollectionOnly, shippingMethods]);

  // Experiences fulfil on-site (ON_SITE_SERVICE) — no courier, no parcel.
  // Mirror the collection-only lock: when the seller switches into an
  // experience category, force shippingMethods to ['ON_SITE_SERVICE'] and
  // keep it locked (the courier picker + parcel inputs are hidden below).
  const lastIsExperience = useRef(isExperience);
  useEffect(() => {
    if (lastIsExperience.current !== isExperience) {
      lastIsExperience.current = isExperience;
      if (isExperience) setShippingMethods(['ON_SITE_SERVICE']);
    }
  }, [isExperience]);
  useEffect(() => {
    if (
      isExperience &&
      (shippingMethods.length !== 1 ||
        shippingMethods[0] !== 'ON_SITE_SERVICE')
    ) {
      setShippingMethods(['ON_SITE_SERVICE']);
    }
  }, [isExperience, shippingMethods]);
  // Collection-only items settle through the standard checkout, which only
  // handles Buy Now / Auction — Take-a-Shot's offer-checkout and Swop have no
  // collection path (the backend rejects them). If the seller switches into a
  // collection-only category (or trips the DG battery gate) with a
  // Take-a-Shot / Swop pick still selected, snap the mode back to Buy Now so
  // they never hit an opaque publish error.
  useEffect(() => {
    if (
      (effectiveCollectionOnly || isExperience) &&
      form.listingType !== 'BUY_NOW' &&
      form.listingType !== 'AUCTION'
    ) {
      set('listingType', 'BUY_NOW');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCollectionOnly, isExperience, form.listingType]);

  // ─────────────────── Step completion (drives the accordion) ───────────
  // Each step's `isComplete` is a pure function of the form state.
  // Four steps total: photos → basics → selling → delivery+address.
  // Photos moved to first so the AI "Help me describe this" button
  // can pre-fill basics from the photos before the seller types.
  const stepComplete = useMemo(() => {
    // Step 1 — at least 1 photo.
    const step1 = images.length >= 1;

    // Step 2 — basics: title, category, condition, description.
    // Often pre-filled by the Step 1 AI helper, but the seller can
    // always override / fill manually.
    const step2 =
      form.title.trim().length >= 5 &&
      !!form.categoryId &&
      !!form.condition &&
      form.description.trim().length >= 10 &&
      // Required per-category attributes (P4.2) live in this step's
      // Specifications sub-section — block Continue until they're filled.
      missingRequiredAttrs.length === 0;

    const hasPrice = parseFloat(form.price || '0') > 0;
    const hasReserve = parseFloat(form.reservePrice || '0') > 0;
    // Step 3 — listing type + price. Blocked until the seller picks
    // a listing type AND satisfies that type's price requirement.
    // The empty-string default for listingType (see useState above)
    // means Step 3 shows "Up next" until the seller actively chooses.
    const step3 =
      !form.listingType
        ? false
        : form.listingType === 'TAKE_A_SHOT' || form.listingType === 'SWOP'
          ? true // no price required — buyer names a price / a swap has no sale price
          : form.listingType === 'AUCTION'
            ? (hasPrice || hasReserve) && !!form.durationDays
            : hasPrice;

    // Step 4 — delivery + address. The seller picks ≥1 shipping method
    // and fills the pickup address. NO locker selection here — for PUDO,
    // the seller drops at any locker using a delivery PIN; the buyer
    // picks the destination locker at checkout.
    const addressFilled =
      pickupAddress.street.trim().length > 0 &&
      pickupAddress.suburb.trim().length > 0 &&
      pickupAddress.city.trim().length > 0 &&
      pickupAddress.postalCode.trim().length > 0 &&
      pickupAddress.province.length > 0;
    // Parcel weight + dims required for non-firearm so the courier API
    // has something to quote against. Firearms skip this — DEALER_TRANSFER
    // and PRIVATE_ARRANGE don't use Pudo/TCG. Collection-only listings
    // also skip it — there's no courier, so no parcel to quote.
    const parcelFilled =
      isFirearm ||
      effectiveCollectionOnly ||
      isExperience || // on-site service has no parcel to quote
      (parsedParcel.weightKg != null &&
        parsedParcel.lengthCm != null &&
        parsedParcel.widthCm != null &&
        parsedParcel.heightCm != null);
    // Collection papers attestation — required checkbox for requiresPapers
    // categories (trailers / caravans). Publish is blocked until ticked.
    const papersOk = !requiresPapers || papersAttested;
    // Experience gate — the Experience-details + Supplier-compliance
    // sections replace the courier UI in the final step. Require the core
    // event metadata, the venue, capacity, the package fields (species for a
    // hunt), the supplier registration number + both docs, and all three
    // supplier attestations before the step is complete. Publish is gated
    // again in handlePublish.
    const experienceOk =
      !isExperience ||
      (!!exp.eventStartDate &&
        !!exp.eventProvince &&
        exp.locationText.trim().length > 0 &&
        parseInt(exp.capacitySlots || '0', 10) >= 1 &&
        exp.durationText.trim().length > 0 &&
        exp.whatsIncluded.trim().length > 0 &&
        (!isPlainsGameHunt || species.length > 0) &&
        // window sanity — end (if given) can't precede start
        (!exp.eventEndDate || exp.eventEndDate >= exp.eventStartDate) &&
        supplierRegNumber.trim().length > 0 &&
        !!supplierInsuranceDoc &&
        !!supplierRegDoc &&
        supplierPliAttested &&
        supplierAuthorityAttested &&
        supplierRiskAttested);
    const step4 =
      shippingMethods.length > 0 &&
      addressFilled &&
      parcelFilled &&
      papersOk &&
      experienceOk;

    return { step1, step2, step3, step4 };
  }, [
    form,
    images,
    pickupAddress,
    shippingMethods,
    parsedParcel,
    isFirearm,
    effectiveCollectionOnly,
    requiresPapers,
    papersAttested,
    missingRequiredAttrs,
    isExperience,
    isPlainsGameHunt,
    exp,
    species,
    supplierRegNumber,
    supplierInsuranceDoc,
    supplierRegDoc,
    supplierPliAttested,
    supplierAuthorityAttested,
    supplierRiskAttested,
  ]);

  // Which step is "up next" — the first incomplete one. Drives the red
  // "Up next" pill, NOT auto-expansion. Completing fields just unlocks
  // the Continue button; the user has to click Continue to advance.
  const activeStep: 1 | 2 | 3 | 4 = !stepComplete.step1
    ? 1
    : !stepComplete.step2
      ? 2
      : !stepComplete.step3
        ? 3
        : !stepComplete.step4
          ? 4
          : 4; // all done — leave step 4 active so seller can still edit photos

  // Single source of truth for which step is currently expanded. Only one
  // step is open at a time (classic accordion). Defaults to step 1.
  // Filling out a step does NOT change this — only a Continue click or a
  // user header click does.
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3 | 4 | null>(1);
  const isOpen = (n: number) => expandedStep === n;

  // Furthest step the seller has explicitly advanced to via the Continue
  // button (or Fill form / Continue inside the Step 1 AI helper). Header
  // clicks can navigate BACK to any earlier step, but never FORWARD — the
  // only way to unlock a future step is the explicit Continue action.
  // This is what the operator asked for: "Only the continue or fill form
  // button can jump to the next box."
  const [furthestStep, setFurthestStep] = useState<1 | 2 | 3 | 4>(1);

  function toggleStep(n: 1 | 2 | 3 | 4) {
    // Hard gate: can't jump forward via header click. Have to use the
    // Continue / Fill form button.
    if (n > furthestStep) return;
    if (statusFor(n) === 'locked') return;
    setExpandedStep((prev) => (prev === n ? null : n));
  }

  function advanceFromStep(n: 1 | 2 | 3 | 4) {
    if (!stepComplete[`step${n}` as keyof typeof stepComplete]) return;
    const next = (n + 1) as 1 | 2 | 3 | 4 | 5;
    if (next > 4) {
      setExpandedStep(null);
    } else {
      setExpandedStep(next as 1 | 2 | 3 | 4);
      // Bump the forward-navigation gate — this is the moment the
      // seller has explicitly unlocked the next step's header.
      setFurthestStep((prev) =>
        Math.max(prev, next) as 1 | 2 | 3 | 4,
      );
    }
    // Continuing past Step 2 (basics — the descriptive content) is
    // the right moment to kick the moderation audit — fire-and-forget
    // so the advance is instant for the seller. By the time they reach
    // the Preview button, the result is usually already cached. (Step
    // numbers were re-ordered: Photos is now Step 1, basics Step 2.)
    if (n === 2) {
      void runAudit();
    }
  }

  function statusFor(n: 1 | 2 | 3 | 4): StepStatus {
    // Forward-navigation gate: any step beyond `furthestStep` is
    // visually locked even if its prerequisites are met. The user
    // has to hit Continue (or Fill form on Step 1) to unlock it.
    if (n > furthestStep) return 'locked';
    const key = `step${n}` as keyof typeof stepComplete;
    if (stepComplete[key]) return 'complete';
    for (let i = 1; i < n; i++) {
      if (!stepComplete[`step${i}` as keyof typeof stepComplete]) return 'locked';
    }
    return 'active';
  }

  const allComplete =
    stepComplete.step1 &&
    stepComplete.step2 &&
    stepComplete.step3 &&
    stepComplete.step4;

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Ask Claude (Sonnet) to refine the seller's description AND research
  // factory specs. Returns plain text formatted as two bullet sections;
  // we render it in a preview box below the textarea so the seller can
  // compare it against their own words before swapping.
  async function handleEnhance() {
    if (!form.description.trim() || enhancing) return;
    setEnhanceError(null);
    setEnhancing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/enhance-description`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: form.description,
          title: form.title || undefined,
          categoryId: form.categoryId || undefined,
          condition: form.condition || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      const enhanced = typeof data.enhanced === 'string' ? data.enhanced : '';
      if (enhanced && enhanced.trim() !== form.description.trim()) {
        setSuggestion(enhanced);
      } else {
        setEnhanceError('Description already reads clearly. No changes suggested.');
      }
    } catch (err) {
      setEnhanceError(
        err instanceof Error ? err.message : 'AI rewrite failed',
      );
    } finally {
      setEnhancing(false);
    }
  }

  // RVE — fetch an indicative resale-price range for this item. Uses the
  // title + category + condition the seller has entered so far; the server
  // leads with recent Gun Galore sales and falls back to a web-anchored SA
  // retail price depreciated for condition when local data is thin.
  async function handleEstimatePrice() {
    if (estimating) return;
    const title = form.title.trim();
    if (!title && !form.categoryId) {
      setEstimateError('Add a title and category first.');
      return;
    }
    setEstimateError(null);
    setEstimate(null);
    setEstimating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/estimate-price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title || undefined,
          categoryId: form.categoryId || undefined,
          categorySlug: selectedCategory?.slug || undefined,
          condition: form.condition || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setEstimate(data);
    } catch (err) {
      setEstimateError(
        err instanceof Error ? err.message : 'Could not estimate a price',
      );
    } finally {
      setEstimating(false);
    }
  }

  // Seller accepted the AI's suggestion — copy it into the description
  // and dismiss the preview box.
  function handleUseSuggestion() {
    if (suggestion === null) return;
    set('description', suggestion);
    setSuggestion(null);
    setEnhanceError(null);
  }

  // Seller dismissed the AI's suggestion — drop the preview, keep the
  // existing description as-is.
  function handleKeepOriginal() {
    setSuggestion(null);
    setEnhanceError(null);
  }

  // Google Places picked an address → mirror its parsed components into
  // our form fields so the seller can verify (and tweak if Google
  // mis-located the building).
  function handleAddressComponents(c: ParsedAddressComponents) {
    setPickupAddress((prev) => ({
      ...prev,
      street: c.street ?? prev.street,
      suburb: c.suburb ?? prev.suburb,
      city: c.city ?? prev.city,
      postalCode: c.postalCode ?? prev.postalCode,
      // Convert Google's province name (e.g. "Western Cape") to our enum
      // form ("WESTERN_CAPE"). Falls back to the previous value on miss.
      province: c.province
        ? (c.province.toUpperCase().replace(/[\s-]+/g, '_') as ManualAddressValue['province'])
        : prev.province,
    }));
    setPickupLat(c.lat ?? null);
    setPickupLng(c.lng ?? null);
  }

  // Build the JSON payload shared by /preview and /listings (POST). The two
  // endpoints accept identical body shapes apart from previousAttemptHashes
  // and imageCount, which are preview-only.
  function buildListingPayload(): Record<string, unknown> {
    const isTakeAShot = form.listingType === 'TAKE_A_SHOT';
    // Price-less types: TAKE_A_SHOT (buyer names a price) + SWOP (a swap has
    // no sale price). Neither sends a `price` field.
    const isPriceless = isTakeAShot || form.listingType === 'SWOP';
    // Province comes from the pickup address now (not a separate field on
    // Step 1). Fall back to the form's default if the seller somehow
    // didn't fill an address (shouldn't happen because step 3 gates it).
    const province = pickupAddress.province || form.province;
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim(),
      listingType: form.listingType,
      categoryId: form.categoryId,
      condition: form.condition,
      province,
      passFeeToBuyer: form.passFeeToBuyer,
      // De-dupe defensively so a stale state can't ever send the API a
      // duplicate (which would fail @ArrayMaxSize(2) on the DTO).
      shippingMethods: Array.from(new Set(shippingMethods)),
      // Phase M dealer-lock — only send when populated AND firearm.
      // Non-firearm submissions never carry it (backend ignores it
      // anyway, but no point sending stale state from a category
      // switch).
      ...(isFirearm && plannedDealerLocation.trim()
        ? { plannedDealerLocation: plannedDealerLocation.trim() }
        : {}),
      // Collection papers attestation — only meaningful for requiresPapers
      // categories (trailers / caravans). The seller confirms they hold
      // valid registration + roadworthy papers to hand over at collection.
      ...(requiresPapers
        ? { collectionPapersAttested: papersAttested }
        : {}),
      // P5.4 — optional "tested & working" claim, only for flagged categories.
      ...(showTestedWorking ? { testedWorkingAttested } : {}),
      // Hunting Packages / Experiences (Phase E) — the event metadata +
      // supplier attestations. Only sent for experience categories (the
      // backend strips them otherwise). supplierRegistrationDocUrl /
      // supplierInsuranceUrl are attached in handlePublish after the docs
      // upload, not here (mirrors the firearm serial/licence URL flow).
      ...(isExperience
        ? {
            experienceType: exp.experienceType,
            eventStartDate: exp.eventStartDate
              ? new Date(exp.eventStartDate).toISOString()
              : undefined,
            eventEndDate: exp.eventEndDate
              ? new Date(exp.eventEndDate).toISOString()
              : undefined,
            eventProvince: exp.eventProvince || undefined,
            locationText: exp.locationText.trim() || undefined,
            capacitySlots: exp.capacitySlots
              ? parseInt(exp.capacitySlots, 10)
              : undefined,
            durationText: exp.durationText.trim() || undefined,
            whatsIncluded: exp.whatsIncluded.trim() || undefined,
            rifleProvided: exp.rifleProvided,
            // Species only for a plains-game hunt; a range day sends none.
            ...(isPlainsGameHunt && species.length > 0
              ? { speciesList: species }
              : {}),
            supplierRegistrationNumber: supplierRegNumber.trim() || undefined,
            supplierPublicLiabilityAttested: supplierPliAttested,
            supplierAuthorityAttested,
            supplierRiskDisclosureAttested: supplierRiskAttested,
          }
        : {}),
      pickupBuilding: pickupAddress.building.trim() || undefined,
      pickupStreet: pickupAddress.street.trim() || undefined,
      pickupAddress2: pickupAddress.address2.trim() || undefined,
      pickupSuburb: pickupAddress.suburb.trim() || undefined,
      pickupCity: pickupAddress.city.trim() || undefined,
      pickupPostalCode: pickupAddress.postalCode.trim() || undefined,
      pickupLat: pickupLat ?? undefined,
      pickupLng: pickupLng ?? undefined,
      // pickupPudoLockerId intentionally omitted — seller doesn't pre-pick
      // a Pudo drop-off locker. They drop at any locker with the delivery
      // PIN we issue at dispatch time.
      // Parcel dimensions + weight — required by Pudo/TCG rates. Sent
      // as integers in the units the schema stores (grams + cm). Skipped
      // for firearms since dealer transfers don't use the courier API.
      weightGrams: parsedParcel.weightKg
        ? Math.round(parsedParcel.weightKg * 1000)
        : undefined,
      lengthCm: parsedParcel.lengthCm
        ? Math.round(parsedParcel.lengthCm)
        : undefined,
      widthCm: parsedParcel.widthCm
        ? Math.round(parsedParcel.widthCm)
        : undefined,
      heightCm: parsedParcel.heightCm
        ? Math.round(parsedParcel.heightCm)
        : undefined,
      // Stock (Phase 8a) — only for BUY_NOW non-firearm + >1; backend
      // ignores it otherwise and keeps the listing a single item.
      ...(form.listingType === 'BUY_NOW' && !isFirearm && !isExperience && Math.floor(Number(stock)) > 1
        ? { quantityAvailable: Math.floor(Number(stock)) }
        : {}),
      // Per-category attributes (P4.2) — only sent when the seller filled
      // in at least one. Empty / no-attribute categories omit the key
      // entirely so firearm / other categories are unaffected. The backend
      // validates against the category definitions and drops unknown keys.
      ...(Object.keys(collectedAttributes).length > 0
        ? { attributes: collectedAttributes }
        : {}),
    };
    if (!isPriceless) {
      body.price = Math.round(parseFloat(form.price) * 100);
    }
    if (form.autoAcceptThreshold) {
      body.autoAcceptThreshold = Math.round(
        parseFloat(form.autoAcceptThreshold) * 100,
      );
    }
    if (form.listingType === 'AUCTION') {
      body.durationDays = parseInt(form.durationDays, 10);
      if (form.reservePrice) {
        const reserveCents = Math.round(parseFloat(form.reservePrice) * 100);
        body.reservePrice = reserveCents;
        // Auction-with-reserve: starting bid is derived as 30% below
        // the reserve (= 70% of reserve), rounded DOWN so we never start
        // ABOVE the 30% mark. Whatever the seller typed into the
        // starting-bid input is ignored on this path — the input is
        // hidden anyway when a reserve is set.
        body.price = Math.floor(reserveCents * 0.7);
      }
      // Only send buyNowPrice if the seller explicitly opted in.
      if (form.offerBuyNow && form.buyNowPrice) {
        body.buyNowPrice = Math.round(parseFloat(form.buyNowPrice) * 100);
      }
    }
    return body;
  }

  // Read a File as a base64-encoded data URL, then strip the
  // `data:image/...;base64,` prefix so we send only the payload.
  // Returns { mediaType, data } in the shape the backend expects.
  async function fileToBase64(
    file: File,
  ): Promise<{ mediaType: string; data: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('FileReader returned non-string'));
          return;
        }
        // `data:image/jpeg;base64,XXXX` → { mediaType: 'image/jpeg', data: 'XXXX' }
        const match = result.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          reject(new Error('Unexpected data URL format'));
          return;
        }
        resolve({ mediaType: match[1], data: match[2] });
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  }

  // Shared audit routine. POSTs the current draft to /listings/preview
  // and caches the result in `auditResult`. Triggered automatically when:
  //   - the seller advances past Step 1 (text-only audit)
  //   - they upload, remove, or reorder photos (vision audit)
  // The Preview button below just shows whatever's already in
  // auditResult so the modal opens instantly.
  async function runAudit(): Promise<PreviewResult | null> {
    if (auditing) return null;
    // Step 2 (basics) must be complete before there's anything
    // meaningful to audit — the moderator reads title + description.
    // The Continue handler enforces this too but guard here. Note:
    // step numbers were re-ordered (Photos first, basics second) so
    // the basics gate is now step2, not step1.
    if (!stepComplete.step2) return null;
    setAuditing(true);
    setAuditError(null);
    try {
      const token = await getToken();
      const encodedImages = await Promise.all(images.map(fileToBase64));
      const body = {
        ...buildListingPayload(),
        previousAttemptHashes,
        imageCount: images.length,
        images: encodedImages,
      };
      const res = await fetch(`${API_URL}/listings/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(data.message)
          ? data.message.join(', ')
          : (data.message ?? `Error ${res.status}`);
        throw new Error(msg);
      }
      const result = data as PreviewResult;
      setAuditResult(result);
      return result;
    } catch (err) {
      setAuditError(
        err instanceof Error ? err.message : 'Review check failed',
      );
      return null;
    } finally {
      setAuditing(false);
    }
  }

  // "Preview listing" — opens the modal with the latest audit result.
  // If we haven't audited yet (rare — should auto-fire on Step 1
  // continue), kick one off and open the modal when it lands.
  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!allComplete) return;
    setPreviewLoading(true);
    setError(null);
    setPublishError(null);
    try {
      const result = auditResult ?? (await runAudit());
      if (result) setPreviewResult(result);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Confirmed publish from inside the modal. Creates the listing row
  // then uploads each photo one-by-one. CRITICAL invariant: we MUST
  // NOT redirect to the listing page if any image failed to upload —
  // doing so leaves the seller on a photo-less listing. So:
  //   1. Refuse to start without ≥1 staged image (UI guard mirrors
  //      the server-side @Min(1) on imageCount).
  //   2. Bail with a clear error if listing-create fails.
  //   3. Upload each file in turn, halting on the first failure.
  //   4. If any upload failed, delete the half-built listing so the
  //      seller's "My Listings" doesn't fill up with ghost rows. The
  //      modal stays open with an error + the seller can retry.
  //   5. Only redirect when every image lands.
  async function handlePublish(useCleanedDescription: boolean) {
    if (!previewResult) return;
    if (images.length === 0) {
      setPublishError('Add at least one photo before publishing.');
      return;
    }
    // Firearm compliance guard — serial number + both photos are
    // mandatory for firearm listings. Abort before touching the API if
    // any is missing so the seller gets an instant, clear message rather
    // than a server-side 400. Non-firearm listings skip this entirely.
    if (isFirearm && (!serialNumber.trim() || !serialPhoto || !licencePhoto)) {
      setPublishError(
        'Firearm listings need the serial number, a photo of the serial, and a photo of your licence. Add the missing items in the Delivery & address step.',
      );
      return;
    }
    // Collection papers guard — requiresPapers categories (trailers /
    // caravans) can't publish until the seller attests they hold valid
    // registration + roadworthy papers. Mirrors the firearm guard: abort
    // before touching the API so the seller gets an instant message.
    if (requiresPapers && !papersAttested) {
      setPublishError(
        'Tick the registration & roadworthy papers confirmation in the Delivery & collection step before publishing.',
      );
      return;
    }
    // Experience guard — mirror the firearm guard. Abort before touching the
    // API if the supplier registration/attestations/docs are missing so the
    // seller gets an instant, clear message rather than a server-side 400.
    // Non-experience listings skip this entirely.
    if (
      isExperience &&
      (!supplierRegNumber.trim() ||
        !supplierInsuranceDoc ||
        !supplierRegDoc ||
        !supplierPliAttested ||
        !supplierAuthorityAttested ||
        !supplierRiskAttested)
    ) {
      setPublishError(
        'Experience listings need the supplier registration number, the public-liability insurance certificate, the registration document, and all three supplier confirmations. Add the missing items in the "Supplier & compliance" step.',
      );
      return;
    }
    // Required per-category attributes (P4.2) guard — mirror the firearm /
    // papers guards: abort before the API call so the seller gets an instant,
    // clear message naming the missing fields rather than a server-side 400.
    // The missing fields live in the Specifications sub-section of the
    // "About this item" step.
    if (missingRequiredAttrs.length > 0) {
      setPublishError(
        `Fill in the required specification${missingRequiredAttrs.length === 1 ? '' : 's'} in the "About this item" step: ${missingRequiredAttrs.join(', ')}.`,
      );
      return;
    }
    setSubmitting(true);
    setPublishError(null);
    let createdListingId: string | null = null;
    try {
      const body = buildListingPayload();
      // imageCount tells the backend the seller declared intent to
      // upload N photos. The @Min(1) DTO rule blocks zero-photo
      // submissions. Photos themselves stream up below.
      body.imageCount = images.length;
      if (useCleanedDescription && previewResult.cleanedDescription) {
        body.description = previewResult.cleanedDescription;
      }

      // Firearm compliance — upload the serial + licence photos FIRST,
      // BEFORE creating the listing. The create endpoint runs Claude
      // vision over these URLs and may BLOCK the listing (serial /
      // holder mismatch, expired-or-near-expiry licence, unreadable
      // photo). If this upload fails we abort outright — no listing is
      // created. Mirrors the Authorization header pattern used by the
      // /users/me fetch and the per-image upload below.
      if (isFirearm && serialPhoto && licencePhoto) {
        const docsForm = new FormData();
        docsForm.append('serialPhoto', serialPhoto);
        docsForm.append('licencePhoto', licencePhoto);
        const docsToken = await getToken();
        const docsRes = await fetch(`${API_URL}/listings/firearm-docs`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${docsToken}` },
          body: docsForm,
        });
        if (!docsRes.ok) {
          const errBody = await docsRes.json().catch(() => ({}));
          const msg = Array.isArray(errBody.message)
            ? errBody.message.join(', ')
            : (errBody.message ?? `Error ${docsRes.status}`);
          throw new Error(
            `Couldn't upload your firearm documents — ${msg}`,
          );
        }
        const { serialPhotoUrl, licencePhotoUrl } = (await docsRes.json()) as {
          serialPhotoUrl: string;
          licencePhotoUrl: string;
        };
        body.serialNumber = serialNumber.trim();
        body.serialPhotoUrl = serialPhotoUrl;
        body.licencePhotoUrl = licencePhotoUrl;
      }

      // Experience supplier docs — upload the public-liability insurance
      // cert + the registration document FIRST, before creating the
      // listing, exactly like the firearm serial/licence flow. The backend
      // Claude-vision reviews these; if the upload fails we abort outright so
      // no listing is created. The returned Cloudinary URLs are attached to
      // the create body.
      if (isExperience && supplierInsuranceDoc && supplierRegDoc) {
        const docsForm = new FormData();
        docsForm.append('insuranceDoc', supplierInsuranceDoc);
        docsForm.append('registrationDoc', supplierRegDoc);
        const docsToken = await getToken();
        const docsRes = await fetch(
          `${API_URL}/listings/experience-supplier-docs`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${docsToken}` },
            body: docsForm,
          },
        );
        if (!docsRes.ok) {
          const errBody = await docsRes.json().catch(() => ({}));
          const msg = Array.isArray(errBody.message)
            ? errBody.message.join(', ')
            : (errBody.message ?? `Error ${docsRes.status}`);
          throw new Error(
            `Couldn't upload your supplier documents — ${msg}`,
          );
        }
        const { insuranceUrl, registrationDocUrl } =
          (await docsRes.json()) as {
            insuranceUrl: string;
            registrationDocUrl: string;
          };
        body.supplierInsuranceUrl = insuranceUrl;
        body.supplierRegistrationDocUrl = registrationDocUrl;
      }
      // Fresh token per request. Clerk session JWTs are short-lived
      // (~60s) and verified by exp on the backend. Capturing ONE token
      // for create + every photo upload meant a slow create (moderation
      // hooks) or a slow first upload could leave the token expired by
      // the time the upload request arrived → 401 "Unauthorized" on
      // "Photo 1". getToken() returns the cached token while valid and
      // only refreshes near expiry, so calling it per request is cheap.
      const createToken = await getToken();
      const res = await fetch(`${API_URL}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = Array.isArray(err.message)
          ? err.message.join(', ')
          : (err.message ?? `Error ${res.status}`);
        throw new Error(msg);
      }
      const listing = await res.json();
      createdListingId = listing.id;

      // Per-image upload with res.ok check — the old loop swallowed
      // 4xx/5xx silently and still redirected, leaving the seller on
      // a photo-less listing. Track which file failed so the error
      // message points at the right one.
      let uploaded = 0;
      for (const file of images) {
        const fd = new FormData();
        // IMPORTANT: backend FileInterceptor expects the multipart
        // field name `image` (see backend ListingsController). The
        // old code sent `file` which Multer silently dropped — the
        // request 200'd as an empty upload and listings published
        // with zero photos.
        fd.append('image', file);
        // Fresh token per upload — a multi-photo upload on a slow mobile
        // connection can easily outlive a single 60s token, so refresh
        // before each one rather than reusing the create-time token.
        const upToken = await getToken();
        const up = await fetch(`${API_URL}/listings/${listing.id}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${upToken}` },
          body: fd,
        });
        if (!up.ok) {
          const errBody = await up.json().catch(() => ({}));
          const detail =
            (errBody && (errBody as { message?: string }).message) ||
            `${up.status}`;
          throw new Error(
            `Photo ${uploaded + 1} of ${images.length} (${file.name}) ` +
              `failed to upload — ${detail}.`,
          );
        }
        uploaded += 1;
      }

      // Successful publish — clear the localStorage draft so the
      // form starts fresh on the seller's next listing.
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }

      // Gate: if the seller still owes us the post-publish profile
      // (banking + ID + name), show the modal BEFORE we redirect.
      // BUT respect the 24h "Finish later" suppression flag — if the
      // seller already chose to defer in the last 24h, redirect
      // straight to the listing. Payout is still gated server-side
      // until the profile is actually completed.
      if (
        currentMe &&
        !currentMe.profileCompletedAt &&
        !shouldSuppressProfileModal(currentMe.id)
      ) {
        setPendingRedirectId(listing.id);
        setSubmitting(false);
        return;
      }
      router.push(`/listings/${listing.id}`);
    } catch (err) {
      // Half-built listing cleanup: if create() succeeded but some
      // image upload failed mid-way, delete the listing so it doesn't
      // sit forever as a photo-less ghost. Fire-and-forget — if cleanup
      // also fails, we still want to surface the original error to the
      // seller; admin can purge the orphan separately.
      const wasRolledBack = !!createdListingId;
      if (createdListingId) {
        // Fresh token for the rollback DELETE too — the publish failure
        // may itself have been a stale token, so reusing it would also
        // fail and leave the orphan listing behind.
        const delToken = await getToken().catch(() => null);
        void fetch(`${API_URL}/listings/${createdListingId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${delToken}` },
        }).catch(() => undefined);
      }
      const baseMsg =
        err instanceof Error ? err.message : 'Publish failed — try again';
      // Explicit rollback notice so the seller knows the half-built
      // listing was binned (vs. silently existing). Reassurance that
      // their typed form data is preserved courtesy of the draft
      // persistence above.
      setPublishError(
        wasRolledBack
          ? `${baseMsg} The half-built listing was rolled back so it doesn't sit photo-less. Your typed details are saved on this device — re-select your photos and click Publish again.`
          : baseMsg,
      );
      setSubmitting(false);
    }
  }

  // Closing the preview modal — if the verdict was REJECT, stash the
  // attemptHash so a 2nd attempt with the same sins is hard-blocked
  // server-side.
  function handleClosePreview() {
    if (
      previewResult?.decision === 'REJECT' &&
      previewResult.attemptHash &&
      !previousAttemptHashes.includes(previewResult.attemptHash)
    ) {
      setPreviousAttemptHashes((prev) => [...prev, previewResult.attemptHash]);
    }
    setPreviewResult(null);
    setPublishError(null);
  }

  // Object URLs for the staged photos so the preview modal can render them
  // without needing to upload first. Revoke on cleanup to avoid leaks.
  const imageBlobs = useMemo(
    () => images.map((f) => URL.createObjectURL(f)),
    [images],
  );
  useEffect(() => {
    return () => {
      imageBlobs.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [imageBlobs]);

  // Re-audit whenever the seller's photos change. Debounced 900ms so
  // rapid-fire uploads (drag of 3 files at once) collapse into a single
  // audit. Only fires once basics (Step 2 after re-order) is complete —
  // there's nothing useful to moderate before the seller has typed
  // the description.
  useEffect(() => {
    if (!stepComplete.step2) return;
    const t = setTimeout(() => {
      void runAudit();
    }, 900);
    return () => clearTimeout(t);
    // We intentionally ONLY depend on `images` here, not on stepComplete
    // or runAudit — those change every render. The Step-2 (basics)
    // Continue handler covers the case where step2 just transitioned
    // to complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // Reveal handled by <PageReveal> below — same house-standard 0.5s
  // delay + 1.0s duration we use on every other page. The previous
  // GSAP-driven timeline kept getting killed mid-flight by React 19
  // strict-mode's setup → cleanup → setup cycle, which left the
  // header/sections/sidebar permanently stuck at opacity:0 (the
  // `from()` state). PageReveal uses a scoped CSS keyframe that
  // can't be cancelled mid-animation.

  if (!isLoaded || !isSignedIn) return null;

  return (
    <main
      className="relative max-w-[1280px] mx-auto px-4 py-8 sm:py-12"
      style={{ zIndex: 1 }}
    >
      {/* SA banknotes scenery behind the form, with a black vignette +
          dark tint so it stays "felt, not seen". File lives at
          public/sell-bg.jpeg. */}
      <PageBackground imageSrc="/sell-bg.jpeg" opacity={0.25} />

      <PageReveal variant="slide-up">
      {/* Page header */}
      <header data-reveal className="mb-8 max-w-[760px]">
        <p
          className="text-xs uppercase mb-2"
          style={{
            color: 'var(--red)',
            letterSpacing: '0.18em',
            fontWeight: 500,
          }}
        >
          Sell on Gun Galore
        </p>
        <h1
          className="text-3xl sm:text-4xl mb-2"
          style={{
            color: 'var(--text-primary)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
          }}
        >
          Create a listing
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Honest titles and crisp photos sell faster. Required fields marked{' '}
          <span style={{ color: 'var(--red)' }}>*</span>.
        </p>
      </header>

      {/* Draft restored notice — appears when a previous session's
          form data was loaded from localStorage. Reminds the seller
          that photos still need to be re-selected (File objects don't
          serialise). Dismiss button discards the draft. */}
      {draftRestored && (
        <div
          className="mb-6 px-4 py-3 rounded-[6px] text-sm max-w-[760px]"
          style={{
            background: 'rgba(47,158,107,0.10)',
            border: '0.5px solid rgba(47,158,107,0.45)',
            color: 'var(--text-primary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            lineHeight: 1.5,
          }}
        >
          <span>
            <strong style={{ color: '#2f9e6b' }}>Draft restored</strong> —
            your previously typed details are back. You&apos;ll need to
            re-select photos before you can publish.
          </span>
          <button
            type="button"
            onClick={discardDraft}
            style={{
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              flexShrink: 0,
              padding: '2px 6px',
            }}
          >
            Discard draft
          </button>
        </div>
      )}

      {/* Top-of-form error */}
      {error && (
        <div
          className="mb-6 px-4 py-3 rounded-[6px] text-sm max-w-[760px]"
          style={{
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
          }}
        >
          {error}
        </div>
      )}

      <form
        data-reveal
        onSubmit={handlePreview}
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6"
      >
        {/* ───── Form column ───── */}
        <div className="space-y-3 max-w-[820px]">
          {/* Step 1 — Photos. Photos first so the AI "Help me describe
              this" button can pre-fill the other steps (title, category,
              condition, description) before the seller types anything. */}
          <StepAccordion
            number={1}
            title="Photos"
            description="Buyers click photos first. Bright, sharp, multiple angles. 1–5 photos, drag to reorder."
            status={statusFor(1)}
            expanded={isOpen(1)}
            onToggle={() => toggleStep(1)}
            summary={
              stepComplete.step1
                ? `${images.length} photo${images.length === 1 ? '' : 's'} — cover: ${images[0]?.name ?? '—'}`
                : undefined
            }
            // Continue appears as soon as the first photo lands.
            // Hidden entirely on a fresh form so the empty step reads
            // as just the dropzone, no chrome.
            hideContinue={images.length === 0}
            onContinue={() => advanceFromStep(1)}
            continueDisabled={!stepComplete.step1}
          >
            <PhotoDropzone
              files={images}
              onChange={setImages}
              minFiles={1}
              maxFiles={5}
            />
            {/* Ask GG "Help me describe this" — reads the photos and
                proposes title / description / category / condition.
                Pure helper: parent owns the form state via onApply.
                Sits inside Step 1 so the seller can pre-fill Step 2
                before typing anything. */}
            <IdentifyFromPhotos
              files={images}
              currentCategoryId={form.categoryId}
              categories={categories}
              onApply={(patch) => {
                setForm((f) => ({
                  ...f,
                  title: patch.title ?? f.title,
                  description: patch.description ?? f.description,
                  condition: patch.condition ?? f.condition,
                  categoryId: patch.categoryId ?? f.categoryId,
                }));
              }}
              // Unified advance — same gate as the Continue button so
              // furthestStep bumps and the next header unlocks.
              onAdvance={() => advanceFromStep(1)}
            />
          </StepAccordion>

          {/* Step 2 — About this item (basics + condition + firearm details) */}
          <StepAccordion
            number={2}
            title="About this item"
            description="Tell buyers what it is, what shape it's in, and what makes it interesting."
            status={statusFor(2)}
            expanded={isOpen(2)}
            onToggle={() => toggleStep(2)}
            summary={
              stepComplete.step2
                ? `${form.title.trim()} · ${selectedCategory?.name ?? ''} · ${CONDITION_LABELS[form.condition as keyof typeof CONDITION_LABELS]}`.slice(0, 100)
                : undefined
            }
            onContinue={() => advanceFromStep(2)}
            continueDisabled={!stepComplete.step2}
          >
            <Field label="Title" required>
              <input
                type="text"
                required
                minLength={5}
                maxLength={200}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                style={inputStyle}
                placeholder="e.g. Glock 17 Gen 5 — excellent condition"
              />
            </Field>

            <Field
              label="Category"
              required
              hint="Pick the closest top category, then the sub-type."
            >
              <CategoryPicker
                categories={categories}
                value={form.categoryId || null}
                onChange={(id) => set('categoryId', id)}
                secondhandOnly
              />
            </Field>

            <Field label="Condition" required>
              <PillGroup
                value={form.condition as keyof typeof CONDITION_LABELS}
                onChange={(v) => set('condition', v)}
                options={(
                  Object.entries(CONDITION_LABELS) as [
                    keyof typeof CONDITION_LABELS,
                    string,
                  ][]
                ).map(([k, v]) => ({ value: k, label: v }))}
              />
            </Field>

            {/* Province isn't asked here — we'll derive it from the
                seller's pickup address once the delivery section lands.
                Until then, form.province stays on its default. */}

            {/* No separate make/model/calibre inputs — the AI extracts those
                from the title + description when it polishes the listing,
                and the backend infers isFirearm from the category. */}

            <Field label="Description" required>
              <textarea
                required
                minLength={10}
                maxLength={5000}
                rows={5}
                value={form.description}
                onChange={(e) => {
                  set('description', e.target.value);
                  // If the seller starts editing again, drop the AI
                  // suggestion preview — they're going their own way.
                  if (suggestion !== null) setSuggestion(null);
                }}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="Describe the item honestly. Include wear, modifications, round count, included accessories, and anything else a serious buyer would ask about."
              />

              {/* AI tools row — only show the Refine button when there's
                  no active suggestion (the suggestion box has its own
                  Use this / Keep original buttons). */}
              {suggestion === null && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleEnhance}
                    disabled={enhancing || form.description.trim().length < 10}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] text-xs transition-opacity"
                    style={{
                      background: 'transparent',
                      color: 'var(--red)',
                      border: '0.5px solid var(--red)',
                      fontWeight: 500,
                      cursor:
                        enhancing || form.description.trim().length < 10
                          ? 'not-allowed'
                          : 'pointer',
                      opacity:
                        enhancing || form.description.trim().length < 10
                          ? 0.5
                          : 1,
                    }}
                  >
                    {/* Sparkle icon */}
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M10 1l1.6 4.4L16 7l-4.4 1.6L10 13l-1.6-4.4L4 7l4.4-1.6L10 1zM4 13l.8 2.2L7 16l-2.2.8L4 19l-.8-2.2L1 16l2.2-.8L4 13zM16 12l.5 1.5L18 14l-1.5.5L16 16l-.5-1.5L14 14l1.5-.5L16 12z" />
                    </svg>
                    {enhancing
                      ? 'Researching…'
                      : 'Polish + add specs'}
                  </button>
                </div>
              )}

              {enhanceError && (
                <p
                  className="text-xs mt-2"
                  style={{
                    color: enhanceError.startsWith('Description already')
                      ? 'var(--text-tertiary)'
                      : 'var(--red)',
                  }}
                >
                  {enhanceError}
                </p>
              )}

              {/* Suggestion preview — only when Claude returned something
                  different from the seller's draft. Two bullet sections
                  (seller bullets + Specs & details) shown verbatim. */}
              {suggestion && (
                <div
                  className="mt-3 rounded-[6px] p-4"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  <p
                    className="text-xs uppercase mb-2"
                    style={{
                      color: 'var(--text-tertiary)',
                      letterSpacing: '0.1em',
                      fontWeight: 500,
                    }}
                  >
                    Suggested wording
                  </p>
                  <div
                    className="text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {suggestion}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={handleUseSuggestion}
                      className="px-4 py-2 rounded-[6px] text-xs"
                      style={{
                        background: 'var(--red)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Use this
                    </button>
                    <button
                      type="button"
                      onClick={handleKeepOriginal}
                      className="px-4 py-2 rounded-[6px] text-xs"
                      style={{
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '0.5px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      Keep original
                    </button>
                  </div>
                </div>
              )}
            </Field>

            {/* Specifications (P4.2) — dynamic per-category attribute
                fields. Only rendered when the selected category has ≥1
                attribute definition; firearm / other categories with none
                render nothing here and send no `attributes`. Required
                attributes carry the same * indicator and gate Continue /
                Publish (see stepComplete.step2 + the handlePublish guard). */}
            {attrDefs.length > 0 && (
              <div className="pt-1">
                <p
                  className="text-xs uppercase mb-1"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.05em',
                    fontWeight: 500,
                  }}
                >
                  Specifications
                </p>
                <p
                  className="text-xs mb-3"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
                >
                  Structured details for this category. Buyers filter and
                  compare on these.
                </p>
                <div className="space-y-4">
                  {attrDefs.map((def) => (
                    <AttributeField
                      key={def.id}
                      def={def}
                      value={attrValues[def.key]}
                      onChange={(next) =>
                        setAttrValues((prev) => ({ ...prev, [def.key]: next }))
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </StepAccordion>

          {/* Step 3 — Listing type + pricing */}
          <StepAccordion
            number={3}
            title="How are you selling?"
            description="Each option has different rules. You can always change later."
            status={statusFor(3)}
            expanded={isOpen(3)}
            onToggle={() => toggleStep(3)}
            summary={
              stepComplete.step3
                ? `${
                    form.listingType === 'BUY_NOW'
                      ? 'Marketplace'
                      : form.listingType === 'AUCTION'
                        ? 'Auction'
                        : form.listingType === 'SWOP'
                          ? 'Swop / Trade'
                          : 'Take a Shot'
                  }${form.price ? ` · R${form.price}` : ''}`
                : undefined
            }
            onContinue={() => advanceFromStep(3)}
            continueDisabled={!stepComplete.step3}
          >
            <Field
              label="Listing type"
              required
              tipTitle="Three ways to sell"
              tip={
                <>
                  <strong>Marketplace:</strong> fixed price, buyer hits Buy
                  and pays. Fastest sale. <br />
                  <strong>Auction:</strong> timed bidding with snipe
                  protection. Best for items where value is uncertain.
                  <br />
                  <strong>Take a Shot:</strong> buyers send offers; you
                  accept, decline, or counter once. Good when you&apos;re
                  open to negotiation. <br />
                  <strong>Swop / Trade:</strong> buyers propose trading their
                  item for yours, with optional cash either way. Good when
                  you&apos;d rather upgrade than sell.
                </>
              }
            >
              {/* Descriptive choice cards — each mode shows what it is and
                  what it's best for, visible BEFORE the seller picks, so they
                  know where to list and why. Selecting one sets listingType. */}
              <div className="flex flex-col gap-2">
                {/* Collection-only categories (trailers / caravans) settle
                    through the standard checkout — only Buy Now + Auction are
                    offered; Take-a-Shot + Swop have no collection path. An
                    experience (hunting package) is the same: sold as a
                    fixed-price booking or auctioned, never Take-a-Shot/Swop. */}
                {SELL_MODES.filter(
                  (m) =>
                    (!effectiveCollectionOnly && !isExperience) ||
                    m.value === 'BUY_NOW' ||
                    m.value === 'AUCTION',
                ).map((m) => {
                  const selected = form.listingType === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => set('listingType', m.value)}
                      aria-pressed={selected}
                      className="text-left rounded-[8px] p-3"
                      style={{
                        background: selected
                          ? 'rgba(200,16,46,0.06)'
                          : 'var(--bg-card)',
                        border: `1px solid ${selected ? 'var(--red)' : 'var(--border)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-sm"
                          style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                        >
                          {m.name}
                        </span>
                        <span
                          aria-hidden
                          className="text-[11px]"
                          style={{
                            color: selected ? 'var(--red)' : 'var(--text-tertiary)',
                            fontWeight: 500,
                          }}
                        >
                          {selected ? '✓ Selected' : 'Choose'}
                        </span>
                      </div>
                      <p
                        className="text-xs mt-0.5 mb-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {m.tagline}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.bestFor.map((b) => (
                          <span
                            key={b}
                            className="text-[11px] px-2 py-0.5 rounded-full"
                            style={{
                              background: 'var(--bg-inset)',
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
              <a
                href="/how-selling-works"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs mt-2"
                style={{ color: 'var(--red)' }}
              >
                Not sure which to pick? See how selling works →
              </a>
            </Field>


            {/* ─── Pricing UI per surface ──────────────────────────
                BUY_NOW  → single Price input.
                AUCTION  → see auction block below; starting bid is
                           either typed (no-reserve) or derived from
                           the reserve at 70% (with-reserve).
                TAKE_A_SHOT → handled separately under its own block. */}
            {/* RVE — "Suggest a price" (indicative resale estimate). Renders
                for the single-price Buy-Now flow. Button-triggered so it only
                spends an AI/web lookup on explicit intent. */}
            {form.listingType === 'BUY_NOW' && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Not sure what to charge?
                  </div>
                  <button
                    type="button"
                    onClick={handleEstimatePrice}
                    disabled={estimating || (!form.title.trim() && !form.categoryId)}
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '0.5px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      cursor:
                        estimating || (!form.title.trim() && !form.categoryId)
                          ? 'not-allowed'
                          : 'pointer',
                      opacity:
                        estimating || (!form.title.trim() && !form.categoryId)
                          ? 0.6
                          : 1,
                    }}
                  >
                    {estimating ? 'Estimating…' : '💡 Suggest a price'}
                  </button>
                </div>
                {estimateError && (
                  <p style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: 8 }}>
                    {estimateError}
                  </p>
                )}
                {estimate &&
                  (estimate.available &&
                  estimate.low != null &&
                  estimate.high != null ? (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        R{Math.round(estimate.low / 100).toLocaleString('en-ZA')} –
                        R{Math.round(estimate.high / 100).toLocaleString('en-ZA')}
                      </div>
                      {estimate.note && (
                        <p
                          style={{
                            fontSize: 12,
                            color: 'var(--text-tertiary)',
                            marginTop: 4,
                          }}
                        >
                          {estimate.note}
                        </p>
                      )}
                      {estimate.midpoint != null && (
                        <button
                          type="button"
                          onClick={() =>
                            set(
                              'price',
                              String(Math.round(estimate.midpoint! / 100)),
                            )
                          }
                          style={{
                            marginTop: 8,
                            fontSize: 12,
                            fontWeight: 500,
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: 'none',
                            background: 'var(--accent, #1a7f5a)',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          Use R
                          {Math.round(estimate.midpoint / 100).toLocaleString('en-ZA')}
                        </button>
                      )}
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                          marginTop: 8,
                        }}
                      >
                        {estimate.disclaimer}
                      </p>
                    </div>
                  ) : (
                    <p
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        marginTop: 8,
                      }}
                    >
                      {estimate.note ??
                        'Not enough data to estimate this item yet.'}
                    </p>
                  ))}
              </div>
            )}

            {form.listingType === 'BUY_NOW' && (
              <Field
                label="Price"
                required
                hint="Whole rands. Cents are accepted but rarely used."
              >
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-tertiary)',
                      fontSize: 14,
                    }}
                  >
                    R
                  </span>
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value)}
                    style={{ ...inputStyle, paddingLeft: 26 }}
                    placeholder="0.00"
                  />
                </div>
                <PriceBreakdown
                  priceCents={Math.round((parseFloat(form.price) || 0) * 100)}
                />
              </Field>
            )}

            {/* Quantity — right under the Buy-Now price so it's part of the
                pricing decision, not buried in the delivery step. Only
                Buy-Now non-firearm (auctions + firearms are single-item). An
                experience is a slot booking, never multi-unit stock. */}
            {form.listingType === 'BUY_NOW' && !isFirearm && !isExperience && (
              <Field
                label="Quantity available"
                hint="How many identical units are you selling? Your listing stays live until every unit sells. Leave at 1 for a single item."
              >
                <div className="max-w-[160px]">
                  <SmallNumberField
                    label="Units available"
                    value={stock}
                    onChange={(v) => setStock(v)}
                    placeholder="1"
                  />
                </div>
              </Field>
            )}

            {/* Swop / Trade — no price. The seller publishes the item they
                want to trade; buyers propose a swap (their item ± cash) on
                the live listing. Negotiation happens there, not here. */}
            {form.listingType === 'SWOP' && (
              <Field label="No price needed">
                <div
                  className="rounded-[10px] p-4 text-sm"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  A Swop / Trade listing has no sale price. You&apos;re
                  publishing the item you want to trade — buyers browse, then
                  propose a swap (their item, plus optional cash either way) on
                  your listing. You review each proposal and accept, decline, or
                  counter the cash. Gun Galore arranges both couriers and the
                  funds are held until both parcels are delivered.
                </div>
              </Field>
            )}

            {/* Auction block — Duration + Reserve + Starting bid.
                When the seller sets a reserve, the starting bid is
                hidden + derived as floor(reserve * 0.7). When they
                leave reserve blank, they type the starting bid
                directly. Buy Now removed per operator decision. */}
            {form.listingType === 'AUCTION' && (
              <>
                <Field label="Duration" required>
                  <PillGroup
                    value={form.durationDays}
                    onChange={(v) => set('durationDays', v)}
                    options={[
                      { value: '3', label: '3 days' },
                      { value: '5', label: '5 days' },
                      { value: '7', label: '7 days' },
                      { value: '14', label: '14 days' },
                    ]}
                  />
                </Field>

                <Field
                  label="Reserve price"
                  hint="Hidden from bidders. Leave blank for no reserve — you'll then type the starting bid directly below."
                  tip={
                    <>
                      The lowest price you&apos;ll accept. Hidden from
                      bidders. Bids count toward closing the sale only
                      once they meet this number. When set, the starting
                      bid is automatically 30% below your reserve so
                      bidding can start low without giving the number
                      away.
                    </>
                  }
                >
                  <PriceInput
                    value={form.reservePrice}
                    onChange={(v) => set('reservePrice', v)}
                    placeholder="No reserve"
                  />
                </Field>

                {/* Buy Now — opt-in. Seller ticks the box, then types
                    the price. Unticking blanks the value so we don't
                    submit a stale figure if they change their mind. */}
                <div>
                  <label
                    className="flex items-start gap-2 cursor-pointer"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={form.offerBuyNow}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setForm((f) => ({
                          ...f,
                          offerBuyNow: checked,
                          buyNowPrice: checked ? f.buyNowPrice : '',
                        }));
                      }}
                      style={{
                        accentColor: 'var(--red)',
                        marginTop: 3,
                      }}
                    />
                    <span className="text-sm">
                      Offer Buy Now
                      <span
                        className="block text-xs mt-0.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Lets a buyer skip bidding and buy outright — only
                        honoured while no bids have landed.
                      </span>
                    </span>
                  </label>

                  {form.offerBuyNow && (
                    <div className="mt-3 ml-6">
                      <Field
                        label="Buy Now price"
                        hint="Shown on the listing as 'Buy Now — R{X}'. Must exceed the starting bid."
                      >
                        <PriceInput
                          value={form.buyNowPrice}
                          onChange={(v) => set('buyNowPrice', v)}
                          placeholder="0.00"
                        />
                      </Field>
                    </div>
                  )}
                </div>

                {form.reservePrice ? (
                  // ─── Reserve set → starting bid is derived ────
                  (() => {
                    const reserveCents = Math.round(
                      parseFloat(form.reservePrice || '0') * 100,
                    );
                    const startCents = Math.floor(reserveCents * 0.7);
                    return (
                      <div
                        style={{
                          background: 'var(--bg-inset)',
                          border: '0.5px solid var(--border)',
                          borderRadius: 6,
                          padding: '12px 14px',
                        }}
                      >
                        <p
                          className="text-xs uppercase mb-1"
                          style={{
                            color: 'var(--text-tertiary)',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Starting bid (calculated)
                        </p>
                        <p
                          className="text-lg"
                          style={{
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                          }}
                        >
                          R{(startCents / 100).toLocaleString('en-ZA', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                        <p
                          className="text-xs mt-1 mb-3"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Set at 30% below your reserve. Buyers see this
                          as the opening bid; we never reveal the
                          reserve itself.
                        </p>
                        {/* Payout preview is computed on the RESERVE,
                            not the starting bid. The starting bid is a
                            hook to get bidding going — what the seller
                            actually cares about is what they'll receive
                            IF the auction reaches reserve. */}
                        <p
                          className="text-xs uppercase mb-1 mt-4"
                          style={{
                            color: 'var(--text-tertiary)',
                            letterSpacing: '0.05em',
                          }}
                        >
                          If the auction reaches your reserve of R
                          {(reserveCents / 100).toLocaleString('en-ZA', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                        <PriceBreakdown priceCents={reserveCents} />
                      </div>
                    );
                  })()
                ) : (
                  // ─── No reserve → seller types starting bid ──
                  <Field
                    label="Starting bid"
                    required
                    hint="Whole rands. Cents are accepted but rarely used."
                  >
                    <div style={{ position: 'relative' }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-tertiary)',
                          fontSize: 14,
                        }}
                      >
                        R
                      </span>
                      <input
                        type="number"
                        required
                        min={1}
                        step="0.01"
                        value={form.price}
                        onChange={(e) => set('price', e.target.value)}
                        style={{ ...inputStyle, paddingLeft: 26 }}
                        placeholder="0.00"
                      />
                    </div>
                    <PriceBreakdown
                      priceCents={Math.round(
                        (parseFloat(form.price) || 0) * 100,
                      )}
                    />
                  </Field>
                )}
              </>
            )}

            {/* Take a Shot extras */}
            {form.listingType === 'TAKE_A_SHOT' && (
              <Field
                label="Auto-accept threshold"
                hint="Hidden from buyers. Any offer at or above this amount is accepted instantly."
                tip={
                  <>
                    A private floor that closes the sale automatically.
                    If a buyer offers at or above this number, the
                    system accepts on your behalf and sends them
                    straight to checkout — no waiting for you to log
                    in. Leave blank if you want to review every offer
                    yourself.
                  </>
                }
              >
                <PriceInput
                  value={form.autoAcceptThreshold}
                  onChange={(v) => set('autoAcceptThreshold', v)}
                  placeholder="Optional"
                />
                {/* Explicit "this is binding" warning only when the
                    seller actually sets a value — the warning would
                    be noise if the field is blank. */}
                {form.autoAcceptThreshold && (
                  <p
                    className="text-xs mt-2 px-2 py-1.5 rounded"
                    style={{
                      background: 'rgba(245,158,11,0.10)',
                      border: '0.5px solid rgba(245,158,11,0.40)',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: '#f59e0b' }}>Heads up —</strong>{' '}
                    offers at or above this price become binding
                    sales the moment the buyer hits send. You
                    won&apos;t review them. Leave blank if you want to
                    accept every offer manually.
                  </p>
                )}
              </Field>
            )}
          </StepAccordion>

          {/* Step 4 — Delivery & address */}
          <StepAccordion
            number={4}
            title={
              isExperience
                ? 'Experience, supplier & address'
                : effectiveCollectionOnly
                  ? 'Collection & address'
                  : 'Delivery & address'
            }
            description={
              isExperience
                ? 'A hunting package is a future-dated on-site experience — no courier. Add the event details, your supplier registration + compliance, and a contact/pickup address.'
                : effectiveCollectionOnly
                ? 'Buyers collect this item in person from you — no courier. Add your pickup address so buyers know where they’re collecting from.'
                : isFirearm
                ? 'Firearms must move through a SAPS-licensed dealer. Pick one or both arrangement options below, then add your pickup address.'
                : 'Pick which couriers you offer, then add the pickup address. We use it to suggest your nearest Pudo locker.'
            }
            status={statusFor(4)}
            expanded={isOpen(4)}
            onToggle={() => toggleStep(4)}
            summary={
              stepComplete.step4
                ? isExperience
                  ? `${EXPERIENCE_TYPE_LABELS[exp.experienceType]} · ${exp.eventStartDate || 'date set'}`
                  : effectiveCollectionOnly
                  ? `Collection only · ${pickupAddress.city || 'pickup set'}`
                  : `${shippingMethods.length} method${shippingMethods.length === 1 ? '' : 's'} · ${pickupAddress.city || 'pickup set'}`
                : undefined
            }
            onContinue={() => advanceFromStep(4)}
            continueDisabled={!stepComplete.step4}
          >
            {/* Parcel info — captured first so the delivery picker below
                can disable PUDO if the parcel overshoots locker limits.
                Hidden for firearms because DEALER_TRANSFER and
                PRIVATE_ARRANGE don't use the courier API. Also hidden for
                collection-only listings — there's no courier to quote. */}
            {!isFirearm && !effectiveCollectionOnly && !isExperience && (
              <Field
                label="Parcel weight & size"
                required
                hint="We use this to quote real Pudo / TCG rates at checkout. Pudo's largest locker box is 60 × 41 × 69 cm at 20 kg — anything bigger ships TCG door-to-door."
                tip={
                  <>
                    Used to quote couriers in real time. Pudo (locker
                    drops) is cheapest and capped at 60 × 41 × 69 cm /
                    20 kg. Anything bigger or heavier ships via TCG
                    door-to-door.
                  </>
                }
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SmallNumberField
                    label="Weight (kg)"
                    value={parcel.weightKg}
                    onChange={(v) => setParcel((p) => ({ ...p, weightKg: v }))}
                    placeholder="2.5"
                  />
                  <SmallNumberField
                    label="Length (cm)"
                    value={parcel.lengthCm}
                    onChange={(v) => setParcel((p) => ({ ...p, lengthCm: v }))}
                    placeholder="40"
                  />
                  <SmallNumberField
                    label="Width (cm)"
                    value={parcel.widthCm}
                    onChange={(v) => setParcel((p) => ({ ...p, widthCm: v }))}
                    placeholder="30"
                  />
                  <SmallNumberField
                    label="Height (cm)"
                    value={parcel.heightCm}
                    onChange={(v) => setParcel((p) => ({ ...p, heightCm: v }))}
                    placeholder="10"
                  />
                </div>
                {isOversizeForPudo && (
                  <p
                    className="text-xs mt-2"
                    style={{
                      color: '#f59e0b',
                      lineHeight: 1.55,
                    }}
                  >
                    Too big for a Pudo locker — only door-to-door (TCG)
                    will be offered to buyers. Buyers will see this listing
                    as &ldquo;courier only&rdquo;.
                  </p>
                )}
              </Field>
            )}

            {/* ── Hunting Packages / Experiences (Phase E) ──────────────
                Replaces the courier/parcel + delivery-method UI. Two
                sub-sections: "Experience details" (event window, venue,
                capacity, package type + species, what's-included, rifle)
                and "Supplier & compliance" (registration number, the two
                doc uploaders reusing the firearm File-state pattern, three
                mandatory attestations). shippingMethods is locked to
                ['ON_SITE_SERVICE'] by the effects above. */}
            {isExperience && (
              <div className="space-y-6 mb-4">
                {/* Experience details */}
                <div
                  className="rounded-[6px] p-4 space-y-4"
                  style={{
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  <p
                    className="text-xs uppercase"
                    style={{
                      color: 'var(--text-tertiary)',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    Experience details
                  </p>

                  <Field label="Package type" required>
                    <PillGroup
                      value={exp.experienceType}
                      onChange={(v) =>
                        setExp((e) => ({
                          ...e,
                          experienceType: v as ExperienceType,
                        }))
                      }
                      options={(
                        Object.entries(EXPERIENCE_TYPE_LABELS) as [
                          ExperienceType,
                          string,
                        ][]
                      ).map(([k, label]) => ({ value: k, label }))}
                    />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Event date"
                      required
                      hint="The scheduled date, or the first day of a multi-day package."
                    >
                      <input
                        type="date"
                        value={exp.eventStartDate}
                        onChange={(e) =>
                          setExp((s) => ({
                            ...s,
                            eventStartDate: e.target.value,
                          }))
                        }
                        style={inputStyle}
                      />
                    </Field>
                    <Field
                      label="End date (optional)"
                      hint="Leave blank for a single-day package. Set it for a multi-day window."
                    >
                      <input
                        type="date"
                        value={exp.eventEndDate}
                        min={exp.eventStartDate || undefined}
                        onChange={(e) =>
                          setExp((s) => ({
                            ...s,
                            eventEndDate: e.target.value,
                          }))
                        }
                        style={inputStyle}
                      />
                    </Field>
                  </div>

                  <Field label="Province" required>
                    <select
                      value={exp.eventProvince}
                      onChange={(e) =>
                        setExp((s) => ({
                          ...s,
                          eventProvince: e.target.value,
                        }))
                      }
                      style={inputStyle}
                    >
                      <option value="">Select a province…</option>
                      {Object.entries(PROVINCE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Location"
                    required
                    hint="Property / area, e.g. “Waterberg, near Vaalwater”. Don’t publish an exact street address."
                  >
                    <input
                      type="text"
                      maxLength={200}
                      value={exp.locationText}
                      onChange={(e) =>
                        setExp((s) => ({ ...s, locationText: e.target.value }))
                      }
                      style={inputStyle}
                      placeholder="Waterberg, Limpopo"
                    />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Capacity (guests)"
                      required
                      hint="How many hunters / guests the package accommodates."
                    >
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={exp.capacitySlots}
                        onChange={(e) =>
                          setExp((s) => ({
                            ...s,
                            capacitySlots: e.target.value.replace(/[^0-9]/g, ''),
                          }))
                        }
                        style={inputStyle}
                        placeholder="e.g. 4"
                      />
                    </Field>
                    <Field
                      label="Duration"
                      required
                      hint="e.g. “3 nights / 2 hunting days”."
                    >
                      <input
                        type="text"
                        maxLength={200}
                        value={exp.durationText}
                        onChange={(e) =>
                          setExp((s) => ({
                            ...s,
                            durationText: e.target.value,
                          }))
                        }
                        style={inputStyle}
                        placeholder="3 nights / 2 hunting days"
                      />
                    </Field>
                  </div>

                  {/* Species — only for a plains-game hunt. */}
                  {isPlainsGameHunt && (
                    <Field
                      label="Species on offer"
                      required
                      hint="Tick the plains-game species this package includes."
                    >
                      <MultiSelectPillGroup<string>
                        value={species}
                        onChange={setSpecies}
                        options={SPECIES_OPTIONS.map((s) => ({
                          value: s,
                          label: s,
                        }))}
                      />
                    </Field>
                  )}

                  <Field
                    label="What’s included"
                    required
                    hint="Accommodation, PH / guide, field prep, meals, transfers — set clear expectations."
                  >
                    <textarea
                      maxLength={5000}
                      rows={4}
                      value={exp.whatsIncluded}
                      onChange={(e) =>
                        setExp((s) => ({
                          ...s,
                          whatsIncluded: e.target.value,
                        }))
                      }
                      style={{ ...inputStyle, resize: 'vertical' }}
                      placeholder="e.g. 3 nights’ chalet accommodation, professional hunter, daily field prep, all meals, transfers from the airstrip. Trophy fees quoted separately."
                    />
                  </Field>

                  <label
                    className="flex items-start gap-2 cursor-pointer"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={exp.rifleProvided}
                      onChange={(e) =>
                        setExp((s) => ({
                          ...s,
                          rifleProvided: e.target.checked,
                        }))
                      }
                      style={{ accentColor: 'var(--red)', marginTop: 3 }}
                    />
                    <span className="text-sm">
                      A rifle is provided with this package
                      <span
                        className="block text-xs mt-0.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Leave unticked if the guest brings their own firearm.
                        Buyers see this on the listing.
                      </span>
                    </span>
                  </label>
                </div>

                {/* Supplier & compliance */}
                <div
                  className="rounded-[6px] p-4 space-y-4"
                  style={{
                    background: 'rgba(200,16,46,0.06)',
                    border: '0.5px solid var(--red)',
                  }}
                >
                  <p
                    className="text-xs uppercase"
                    style={{
                      color: 'var(--red)',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    Supplier &amp; compliance — required
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                  >
                    Every experience listing is reviewed before it goes live.
                    You are the supplier of this package — Gun Galore is a
                    payment-protection intermediary. Provide your registration
                    and public-liability cover so buyers know they’re booking
                    with a bona-fide outfitter.
                  </p>

                  <Field
                    label="PH / outfitter registration number"
                    required
                    hint="Your professional hunter or hunting-outfitter registration number."
                  >
                    <input
                      type="text"
                      maxLength={120}
                      value={supplierRegNumber}
                      onChange={(e) => setSupplierRegNumber(e.target.value)}
                      style={inputStyle}
                      placeholder="e.g. LP/OUT/2024/00123"
                    />
                  </Field>

                  <Field
                    label="Public-liability insurance certificate"
                    required
                    hint="Upload your current PLI cover certificate (PDF or photo). Reviewed before the listing goes live."
                  >
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) =>
                        setSupplierInsuranceDoc(e.target.files?.[0] ?? null)
                      }
                      style={{
                        ...inputStyle,
                        padding: '8px 12px',
                        cursor: 'pointer',
                      }}
                    />
                    {supplierInsuranceDoc && (
                      <p
                        className="text-xs mt-1.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Selected: {supplierInsuranceDoc.name}
                      </p>
                    )}
                  </Field>

                  <Field
                    label="Registration document"
                    required
                    hint="Upload your PH / outfitter registration document (PDF or photo)."
                  >
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) =>
                        setSupplierRegDoc(e.target.files?.[0] ?? null)
                      }
                      style={{
                        ...inputStyle,
                        padding: '8px 12px',
                        cursor: 'pointer',
                      }}
                    />
                    {supplierRegDoc && (
                      <p
                        className="text-xs mt-1.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Selected: {supplierRegDoc.name}
                      </p>
                    )}
                  </Field>

                  <div className="space-y-3 pt-1">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supplierPliAttested}
                        onChange={(e) =>
                          setSupplierPliAttested(e.target.checked)
                        }
                        style={{ marginTop: 3, accentColor: 'var(--red)' }}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        I hold valid public-liability insurance covering this
                        experience, and the certificate I uploaded is current.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supplierAuthorityAttested}
                        onChange={(e) =>
                          setSupplierAuthorityAttested(e.target.checked)
                        }
                        style={{ marginTop: 3, accentColor: 'var(--red)' }}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        I am a registered outfitter / PH (or duly authorised to
                        offer this package) and hold the required permits to
                        run it lawfully.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supplierRiskAttested}
                        onChange={(e) =>
                          setSupplierRiskAttested(e.target.checked)
                        }
                        style={{ marginTop: 3, accentColor: 'var(--red)' }}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        I will disclose the material risks of this activity to
                        every guest and run it to accepted safety standards. I
                        understand Gun Galore is a payment-protection
                        intermediary, not the supplier.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Collection-only info panel — replaces the whole courier
                picker. There's nothing for the seller to choose: the item
                is collected in person from them, so we just explain the
                flow and force shippingMethods = ['COLLECTION'] (see the
                effect above). Two reasons land here: a genuinely
                collection-only category (trailers), or the P4.3b DG battery
                gate (battery_wh > 100 Wh). When it's the DG gate on a
                category that ISN'T itself collection-only, swap in the
                dangerous-goods explanation so the seller understands why the
                courier options vanished as they typed the value. */}
            {effectiveCollectionOnly && (
              <div
                className="rounded-[6px] p-4 text-sm space-y-2 mb-4"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.55,
                }}
              >
                <p
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Collection only
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {dgLithiumRestricted && !collectionOnly
                    ? `Batteries rated over ${dgWhThreshold} Wh can’t be couriered (dangerous-goods rules), so this listing is collection-only — the buyer collects in person and their payment is held until they confirm collection.`
                    : 'Buyers collect this item in person — no courier. You’ll coordinate a pickup time with the buyer after they pay. Their payment is held until they confirm collection.'}
                </p>
              </div>
            )}

            {/* Collection papers attestation — required checkbox for
                requiresPapers categories (trailers / caravans). Checkbox
                only (POPIA — never upload or display actual documents).
                Publish is gated on this being ticked (see stepComplete +
                handlePublish). */}
            {requiresPapers && (
              <div
                className="rounded-[6px] p-4 text-sm space-y-3 mb-4"
                style={{
                  background: 'rgba(200,16,46,0.06)',
                  border: '0.5px solid var(--red)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.55,
                }}
              >
                <p
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--red)',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Registration & roadworthy papers — required confirmation
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={papersAttested}
                    onChange={(e) => setPapersAttested(e.target.checked)}
                    style={{ marginTop: 3, accentColor: 'var(--red)' }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    I confirm I hold valid registration and roadworthy
                    papers for this item and will hand them to the buyer at
                    collection.
                  </span>
                </label>
                <p
                  className="text-xs"
                  style={{
                    color: papersAttested ? '#00a03c' : 'var(--text-tertiary)',
                  }}
                >
                  {papersAttested
                    ? '✓ Confirmed. You can publish once the rest of this step is complete.'
                    : 'Tick the box to publish this listing.'}
                </p>
              </div>
            )}

            {/* P5.4 — OPTIONAL "tested & working" seller attestation for
                electronics/appliances. Never gates publish. Worded as the
                SELLER'S own claim, explicitly NOT a Gun Galore test (CPA s41). */}
            {showTestedWorking && (
              <div
                className="rounded-[6px] p-4 text-sm space-y-2 mb-4"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.55,
                }}
              >
                <p
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Tested &amp; working (optional)
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={testedWorkingAttested}
                    onChange={(e) => setTestedWorkingAttested(e.target.checked)}
                    style={{ marginTop: 3, accentColor: 'var(--red)' }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    I powered this item on and it was working when I tested it
                    within the last 7 days. This is my own statement — not a Gun
                    Galore test or guarantee. It shows as a &ldquo;Seller
                    attests: tested &amp; working&rdquo; badge and is recorded if
                    a dispute is later raised.
                  </span>
                </label>
              </div>
            )}

            {!effectiveCollectionOnly && !isExperience && (
            <Field
              label="Delivery options"
              required
              tipTitle="Delivery options"
              tip={
                isFirearm ? (
                  <>
                    <strong>Dealer-stocked transfer:</strong> you drop the
                    firearm at your registered dealer, the buyer collects
                    from theirs. Both must be SAPS-licensed. <br />
                    <strong>Arrange privately:</strong> you and the buyer
                    meet at a dealer to do the licence transfer in person.
                    Use this for local sales.
                  </>
                ) : (
                  <>
                    <strong>Pudo locker-to-locker:</strong> cheapest. You
                    drop at any Pudo locker, buyer picks any locker to
                    collect. Self-service, 24/7. Capped at 60 × 41 × 69 cm
                    / 20 kg. <br />
                    <strong>The Courier Guy (TCG):</strong> door-to-door
                    pickup and delivery. Pricier but works for any size or
                    weight.
                  </>
                )
              }
            >
              <MultiSelectPillGroup<ShippingMethod>
                value={shippingMethods}
                onChange={(next) => {
                  // Phase M dealer-lock — defensive guard: never
                  // allow DEALER_TRANSFER to be dropped on a firearm
                  // listing. The option below is also `disabled` so
                  // the user can't toggle it via the pill, but this
                  // catches any onChange path that bypasses the
                  // disabled flag (keyboard, programmatic).
                  if (isFirearm && !next.includes('DEALER_TRANSFER')) {
                    setShippingMethods([
                      'DEALER_TRANSFER',
                      ...next.filter((m) => m !== 'DEALER_TRANSFER'),
                    ]);
                    return;
                  }
                  setShippingMethods(next);
                }}
                options={
                  isFirearm
                    ? [
                        {
                          value: 'DEALER_TRANSFER',
                          label: 'Dealer-stocked transfer · required',
                          description:
                            'You drop with your dealer; buyer collects from theirs. Required for all firearm listings.',
                          disabled: true,
                        },
                        {
                          value: 'PRIVATE_ARRANGE',
                          label: 'Also offer: Arrange privately',
                          description:
                            'Optional. Buyer + seller meet at a dealer to do the transfer in person.',
                        },
                      ]
                    : [
                        {
                          value: 'PUDO',
                          label: isOversizeForPudo
                            ? 'Pudo locker (unavailable — too large)'
                            : 'Pudo locker-to-locker',
                          description: isOversizeForPudo
                            ? 'Parcel exceeds Pudo locker box limits.'
                            : 'Self-service drop & collect.',
                          disabled: isOversizeForPudo,
                        },
                        {
                          value: 'TCG',
                          label: 'The Courier Guy',
                          description: 'Door-to-door courier.',
                        },
                      ]
                }
              />
              {/* Phase M dealer-lock — optional hint of where the
                  seller plans to dealer-stock the firearm. Buyers
                  near that dealer see it on listing detail so they
                  can factor it into their decision (e.g. shorter
                  collection drive). Only rendered for firearms;
                  text input below the pills, never required. */}
              {isFirearm && (
                <div className="mt-3">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: 'var(--text-tertiary)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    Where do you plan to dealer-stock this? <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={plannedDealerLocation}
                    onChange={(e) => setPlannedDealerLocation(e.target.value)}
                    placeholder="e.g. Pretoria Arms, Centurion"
                    style={{
                      width: '100%',
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
                  >
                    Shown on the listing so buyers near that dealer
                    know their drive's shorter. You&apos;re not locked
                    in — the actual dealer is captured later when you
                    upload the stock-in proof.
                  </p>
                </div>
              )}
            </Field>
            )}

            {/* Firearm compliance — serial number + serial photo +
                licence photo. Required for all firearm listings. The
                backend runs Claude vision on publish and BLOCKs the
                listing if the serial doesn't match the licence, the
                licence holder isn't you, the licence is within 30 days
                of expiry, or any photo is unreadable. Rendered ONLY for
                firearms so nothing extra is collected (or sent) for
                ordinary gear. */}
            {isFirearm && (
              <div className="space-y-4">
                <Field
                  label="Serial number"
                  required
                  hint="The serial stamped on the firearm or barrel. It must match the serial on your licence exactly."
                >
                  <input
                    type="text"
                    maxLength={60}
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    style={inputStyle}
                    placeholder="e.g. ABC123456"
                  />
                </Field>

                <Field
                  label="Clear photo of the serial number"
                  required
                  hint="A sharp, well-lit close-up of the stamped serial. We check it reads cleanly and matches your licence."
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setSerialPhoto(e.target.files?.[0] ?? null)
                    }
                    style={{
                      ...inputStyle,
                      padding: '8px 12px',
                      cursor: 'pointer',
                    }}
                  />
                  {serialPhoto && (
                    <p
                      className="text-xs mt-1.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Selected: {serialPhoto.name}
                    </p>
                  )}
                </Field>

                <Field
                  label="Photo of your firearm licence"
                  required
                  hint="The licence holder must be you, and a licence within 30 days of expiry can't be listed. Make sure the serial and expiry date are legible."
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setLicencePhoto(e.target.files?.[0] ?? null)
                    }
                    style={{
                      ...inputStyle,
                      padding: '8px 12px',
                      cursor: 'pointer',
                    }}
                  />
                  {licencePhoto && (
                    <p
                      className="text-xs mt-1.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Selected: {licencePhoto.name}
                    </p>
                  )}
                </Field>
              </div>
            )}

            <Field
              label="Pickup address"
              required
              hint="Search for your address, then check the details below."
            >
              <AddressAutocomplete
                value={
                  pickupAddress.street
                    ? `${pickupAddress.street}${pickupAddress.suburb ? `, ${pickupAddress.suburb}` : ''}`
                    : ''
                }
                onChange={(addr) => {
                  // Free-text typing in the autocomplete box mirrors into
                  // street if Google hasn't picked anything yet.
                  if (!pickupAddress.street) {
                    setPickupAddress((p) => ({ ...p, street: addr }));
                  }
                }}
                onComponents={handleAddressComponents}
              />
              <div className="mt-3">
                <ManualAddressFields
                  value={pickupAddress}
                  onChange={setPickupAddress}
                  idPrefix="pickup"
                />
              </div>
            </Field>

            {/* Friendly note for PUDO sellers — no locker selection here.
                The seller drops at any Pudo locker using the delivery PIN
                that gets issued at dispatch. */}
            {shippingMethods.includes('PUDO') && (
              <p
                className="text-xs"
                style={{
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.5,
                }}
              >
                Pudo drop-off: once the listing sells you'll get a delivery
                PIN — take the parcel to any Pudo locker, scan the PIN, and
                load it. The buyer picks the destination locker at checkout.
              </p>
            )}
          </StepAccordion>

          {/* Preview listing — enabled once every step is complete.
              The audit usually already ran in the background (on Step 1
              Continue + on photo change), so clicking this just opens
              the modal with the cached verdict. */}
          {(() => {
            const disabled =
              previewLoading || submitting || auditing || !allComplete;
            const completedCount = [
              stepComplete.step1,
              stepComplete.step2,
              stepComplete.step3,
              stepComplete.step4,
            ].filter(Boolean).length;
            // Number of issues the cached audit raised. We only count
            // when the decision is NOT a clean APPROVE — auto-fix /
            // human-review / reject all warrant the seller's attention.
            const issueCount =
              auditResult && auditResult.decision !== 'APPROVE'
                ? auditResult.reasons.length
                : 0;
            const previewBtnLabel = previewLoading
              ? 'Opening preview…'
              : auditing
                ? 'Checking…'
                : allComplete
                  ? issueCount > 0
                    ? `Preview listing (${issueCount} ${issueCount === 1 ? 'issue' : 'issues'})`
                    : 'Preview listing'
                  : `Complete all 4 steps (${completedCount}/4)`;
            return (
              <div className="mt-2">
                <div className="flex gap-3 items-start">
                  <button
                    type="submit"
                    disabled={disabled}
                    className="flex-1 py-3.5 rounded-[6px] text-sm transition-opacity"
                    style={{
                      background: disabled
                        ? 'var(--bg-inset)'
                        : issueCount > 0
                          ? '#f59e0b'
                          : 'var(--red)',
                      color: disabled ? 'var(--text-tertiary)' : '#fff',
                      fontWeight: 500,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      border: 'none',
                    }}
                  >
                    {previewBtnLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-5 py-3.5 rounded-[6px] text-sm"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {!allComplete && (
                  <p
                    className="text-xs mt-2 text-center"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Fill out all four steps above to enable review. We&apos;ll
                    check your listing before it goes live.
                  </p>
                )}
                {previousAttemptHashes.length > 0 && (
                  <p
                    className="text-xs mt-2 text-center"
                    style={{ color: '#f59e0b' }}
                  >
                    Attempt {previousAttemptHashes.length + 1} — make sure
                    you fixed the issues from your last review.
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        {/* ───── Sidebar ───── */}
        <aside className="hidden lg:block">
          <div
            className="sticky top-20 rounded-[8px] p-5 space-y-5"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div>
              <p
                className="text-xs uppercase mb-3"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.1em',
                }}
              >
                Tips for a faster sale
              </p>
              <ul
                className="text-xs space-y-2"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Be specific.
                  </strong>{' '}
                  Detailed titles beat generic ones — include the make,
                  model, year, and condition where relevant.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Photograph in daylight.
                  </strong>{' '}
                  Plain background, several angles, any flaws shown clearly.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Be honest about condition.
                  </strong>{' '}
                  Disclose wear, scratches, or missing parts upfront — it
                  builds trust and avoids returns.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    No contact info in the description.
                  </strong>{' '}
                  Phone numbers and emails are auto-stripped to keep
                  every sale on-platform and protected.
                </li>
              </ul>
            </div>

            <hr style={{ border: 'none', borderTop: '0.5px solid var(--border)' }} />

            <div>
              <p
                className="text-xs uppercase mb-3"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.1em',
                }}
              >
                How you get paid
              </p>
              <ol
                className="text-xs space-y-2"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Buyer pays, funds are held.
                  </strong>{' '}
                  When the sale closes, payment is held safely by Gun
                  Galore — neither side can pull out.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    You dispatch.
                  </strong>{' '}
                  Ship within 48 hours via Pudo or The Courier Guy, or
                  drop at your dealer for firearm transfers.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Buyer confirms delivery.
                  </strong>{' '}
                  Once they accept the item, payment is released —
                  usually within a day of arrival.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Payout to your bank.
                  </strong>{' '}
                  Funds land in your verified bank account within 2-3
                  business days of release. Fees (and our commission)
                  are deducted automatically.
                </li>
              </ol>
            </div>
          </div>
        </aside>
      </form>
      </PageReveal>

      {/* Preview modal — driven by previewResult from POST /listings/preview */}
      {previewResult && (
        <ListingPreviewModal
          preview={previewResult}
          snapshot={
            {
              title: form.title.trim(),
              description: form.description.trim(),
              price: form.price,
              listingType: form.listingType as PreviewSnapshot['listingType'],
              condition: form.condition as PreviewSnapshot['condition'],
              province: form.province as PreviewSnapshot['province'],
              make: '',
              model: '',
              calibre: '',
              category: selectedCategory,
              imageBlobs,
            } satisfies PreviewSnapshot
          }
          publishing={submitting}
          publishError={publishError}
          onEdit={handleClosePreview}
          onPublish={handlePublish}
        />
      )}

      {/* Post-publish profile-completion gate. Pops when the listing
          is created AND the seller hasn't completed their profile
          (banking + ID + name). Cannot be dismissed — onComplete is
          the only exit, and it triggers the deferred redirect to the
          newly-published listing. */}
      {pendingRedirectId && currentMe && (
        <ProfileCompletionModal
          me={currentMe}
          onComplete={() => {
            const id = pendingRedirectId;
            setPendingRedirectId(null);
            router.push(`/listings/${id}`);
          }}
          onFinishLater={() => {
            // Stamp the 24h suppression flag (handled inside the
            // modal via markProfileFinishLater) and continue the
            // happy-path redirect to the listing. The seller is
            // told their payout is blocked via copy below the
            // CTA + a dashboard banner — payout itself stays
            // blocked server-side until the profile is complete.
            const id = pendingRedirectId;
            setPendingRedirectId(null);
            router.push(`/listings/${id}`);
          }}
        />
      )}
    </main>
  );
}

// ─────────────────────────── Small sub-components ────────────────────

// Live breakdown of what the seller actually receives. The payment
// processing fee is paid by the BUYER at checkout (and we keep it), so
// the seller never sees it in this breakdown — only the tiered platform
// commission comes off the listing price.
function PriceBreakdown({ priceCents }: { priceCents: number }) {
  if (priceCents <= 0) return null;
  const commission = calcCommissionCents(priceCents);
  const payout = Math.max(0, priceCents - commission);
  const commissionPct = ((commission / priceCents) * 100).toFixed(1);
  // Tell the seller when the R30 minimum kicked in so they don't think
  // the band rate is broken — common on cheap (< ~R350) listings.
  const hitMinimum =
    commission === MIN_COMMISSION_CENTS &&
    commission > calcUnflooredCommissionCents(priceCents);

  return (
    <div
      className="rounded-[6px] p-4 mt-3"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
        }}
      >
        You receive
      </p>
      <BreakdownRow label="Listing price" value={formatRand(priceCents)} />
      <BreakdownRow
        label={
          hitMinimum
            ? 'Platform commission (R30 minimum)'
            : `Platform commission (~${commissionPct}%, tiered)`
        }
        value={`− ${formatRand(commission)}`}
        muted
      />
      <div
        className="flex justify-between items-baseline pt-2 mt-2"
        style={{ borderTop: '0.5px solid var(--border)' }}
      >
        <span
          className="text-sm"
          style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
        >
          Your payout
        </span>
        <span
          className="text-base"
          style={{
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {formatRand(payout)}
        </span>
      </div>
      <div
        className="text-xs mt-3 pt-3"
        style={{
          color: 'var(--text-tertiary)',
          lineHeight: 1.55,
          borderTop: '0.5px solid var(--border)',
        }}
      >
        <p
          className="mb-1"
          style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
        >
          How the platform fee works
        </p>
        <ul style={{ listStyle: 'disc', paddingLeft: 18, margin: 0 }}>
          {COMMISSION_BANDS.map((b) => (
            <li key={b.label}>{b.label}</li>
          ))}
          <li>
            Minimum platform fee:{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              R{(MIN_COMMISSION_CENTS / 100).toFixed(0)} per sale
            </span>
          </li>
          <li>
            Top Seller tier gets a 0.5% discount once you qualify.
          </li>
        </ul>
      </div>
    </div>
  );
}

// Same commission math as calcCommissionCents but WITHOUT the R30 floor,
// used by PriceBreakdown to detect when the floor kicked in (so we can
// surface "R30 minimum" instead of a percentage label that looks weird
// for tiny listings).
function calcUnflooredCommissionCents(priceCents: number): number {
  let commission = 0;
  let remaining = priceCents;
  for (const band of COMMISSION_BANDS) {
    if (remaining <= 0) break;
    const chunk = isFinite(band.limit)
      ? Math.min(remaining, band.limit)
      : remaining;
    commission += chunk * band.rate;
    remaining -= chunk;
  }
  return Math.max(0, Math.round(commission));
}

function BreakdownRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: muted ? 'var(--text-secondary)' : 'var(--text-primary)',
          fontFamily: 'inherit',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PriceInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)',
          fontSize: 14,
        }}
      >
        R
      </span>
      <input
        type="number"
        min={1}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, paddingLeft: 26 }}
        placeholder={placeholder}
      />
    </div>
  );
}
