'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { av } from '@/lib/asset-version';

interface TrustGuaranteeModalProps {
  /** Optional manual trigger control if used as a controlled dialog */
  isOpen?: boolean;
  onClose?: () => void;
  /** Query parameter key that triggers the modal from URL (default: 'why') */
  paramKey?: string;
}

const SLIDE_DELAYS = ['0.15s', '0.42s', '0.69s'];

const ICON_STYLE: React.CSSProperties = {
  background: 'linear-gradient(140deg, #E01B24 0%, #C4111A 100%)',
  boxShadow: '0 4px 10px -2px rgba(224,27,36,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
};

function TrustGuaranteeModalInner({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  paramKey = 'why',
}: TrustGuaranteeModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);

  // Sync with URL query parameter (?why=alloutdoor or ?guarantee=true)
  useEffect(() => {
    if (controlledIsOpen !== undefined) {
      setIsOpen(controlledIsOpen);
      return;
    }

    const whyVal = searchParams?.get(paramKey);
    const guaranteeVal = searchParams?.get('guarantee');
    if (whyVal === 'alloutdoor' || whyVal === '1' || whyVal === 'true' || guaranteeVal === 'true') {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [searchParams, paramKey, controlledIsOpen]);

  const handleClose = () => {
    if (controlledOnClose) {
      controlledOnClose();
      return;
    }

    setIsOpen(false);

    // Clean URL query param without full page reload
    if (searchParams?.has(paramKey) || searchParams?.has('guarantee')) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete(paramKey);
      nextParams.delete('guarantee');
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes aoSheetSpring {
          0% { opacity: 0; transform: scale(0.92) translateY(24px); }
          70% { transform: scale(1.008) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes aoRowSlideIn {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes aoBrandGlow {
          0%, 100% { background-color: #000000; opacity: 0.35; }
          33%      { background-color: #FFFFFF; opacity: 0.60; }
          66%      { background-color: #E01B24; opacity: 0.50; }
        }
        .ao-sheet { animation: aoSheetSpring 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .ao-row { animation: aoRowSlideIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .ao-halo {
          position: absolute;
          inset: -10px;
          border-radius: 32px;
          filter: blur(30px);
          pointer-events: none;
          z-index: 0;
          animation: aoBrandGlow 10s ease-in-out infinite;
        }
        .ao-tile {
          box-shadow:
            0 1px 1px rgba(20, 20, 20, 0.04),
            0 4px 8px -2px rgba(20, 20, 20, 0.06),
            0 14px 28px -8px rgba(20, 20, 20, 0.10);
          transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1);
        }
        .ao-tile:hover {
          transform: translateY(-3px);
          box-shadow:
            0 2px 2px rgba(20, 20, 20, 0.05),
            0 8px 16px -3px rgba(20, 20, 20, 0.09),
            0 24px 44px -10px rgba(20, 20, 20, 0.14);
        }
        .ao-tile-hero {
          box-shadow:
            0 1px 1px rgba(224, 27, 36, 0.08),
            0 6px 12px -2px rgba(224, 27, 36, 0.12),
            0 20px 40px -10px rgba(224, 27, 36, 0.20);
        }
        .ao-tile-hero:hover {
          box-shadow:
            0 2px 3px rgba(224, 27, 36, 0.10),
            0 10px 20px -3px rgba(224, 27, 36, 0.18),
            0 30px 56px -12px rgba(224, 27, 36, 0.28);
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-modal-title"
      >
        <div className="relative w-full max-w-[540px] my-auto">
          {/* Ambient brand glow, cycling black / white / red */}
          <div className="ao-halo" />

          <div className="ao-sheet relative z-10 w-full bg-white rounded-3xl border border-[#E5E2DC] overflow-hidden shadow-[0_30px_70px_-18px_rgba(0,0,0,0.55)]">
            {/* Fading brand glow behind the header */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-56"
              style={{ background: 'radial-gradient(120% 90% at 50% 0%, rgba(224,27,36,0.10) 0%, rgba(224,27,36,0.02) 45%, transparent 75%)' }}
            />

            {/* Close Button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-4 right-4 text-stone-400 hover:text-[#E01B24] p-2 rounded-full hover:bg-red-50 transition-colors z-20 group"
              aria-label="Close dialog"
            >
              <svg className="w-4 h-4 transition-transform group-hover:rotate-90 duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Header */}
            <div className="relative pt-6 px-7 pb-4">
              <Image
                src={av('/logo-nav-dark.svg')}
                alt={BRAND_NAME}
                width={264}
                height={44}
                priority
                className="h-7 w-auto object-contain mb-4"
              />

              <h2 id="trust-modal-title" className="text-2xl sm:text-[26px] font-extrabold text-[#141414] tracking-tight leading-tight">
                How buying &amp; selling works on {BRAND_NAME}.
              </h2>
            </div>

            {/* 3 Focused Pillars — slide in one by one */}
            <div className="relative px-7 py-2 space-y-3">
              {/* 1. Transaction Protection System */}
              <div
                className="ao-tile ao-tile-hero ao-row p-3.5 rounded-2xl border border-red-200/80 flex items-center gap-4 cursor-default"
                style={{ animationDelay: SLIDE_DELAYS[0], background: 'linear-gradient(135deg, #FFF1F2 0%, #FFFFFF 55%, #FFF7F7 100%)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={ICON_STYLE}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[#141414]">Transaction Protection System</h3>
                  <p className="text-[12px] text-stone-600 mt-0.5 leading-snug">
                    Funds pay out when the product is delivered in the condition advertised.
                  </p>
                </div>
              </div>

              {/* 2. Scam Prevention */}
              <div
                className="ao-tile ao-row p-3.5 rounded-2xl border border-[#E5E2DC] flex items-center gap-4 cursor-default"
                style={{ animationDelay: SLIDE_DELAYS[1], background: 'linear-gradient(135deg, #FFFFFF 0%, #FAF8F5 60%, #FFF5F5 100%)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={ICON_STYLE}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[#141414]">Scam Prevention</h3>
                  <p className="text-[12px] text-stone-600 mt-0.5 leading-snug">
                    Sellers biometric and ID verified.
                  </p>
                </div>
              </div>

              {/* 3. Direct Shipping */}
              <div
                className="ao-tile ao-row p-3.5 rounded-2xl border border-[#E5E2DC] flex items-center gap-4 cursor-default"
                style={{ animationDelay: SLIDE_DELAYS[2], background: 'linear-gradient(135deg, #FFFFFF 0%, #FAF8F5 60%, #FFF5F5 100%)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={ICON_STYLE}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[#141414]">Direct door-to-door shipping</h3>
                  <p className="text-[12px] text-stone-600 mt-0.5 leading-snug">
                    General gear, camping, bows and optics ship straight from seller to buyer.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className="relative mt-2 px-7 py-4 flex items-center justify-end border-t border-[#E5E2DC]"
              style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #FBF7F7 100%)' }}
            >
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl text-white font-semibold text-xs tracking-wide transition-all duration-200 cursor-pointer active:scale-95"
                style={{ background: 'linear-gradient(135deg, #E01B24 0%, #C4111A 100%)', boxShadow: '0 6px 16px -4px rgba(224,27,36,0.5)' }}
              >
                Got It, Browse Gear
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function TrustGuaranteeModal(props: TrustGuaranteeModalProps) {
  return (
    <Suspense fallback={null}>
      <TrustGuaranteeModalInner {...props} />
    </Suspense>
  );
}
