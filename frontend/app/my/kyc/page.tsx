import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import KycForm from './kyc-form';
import { Me } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_CONFIG = {
  NONE: {
    label: 'Not submitted',
    description: 'Submit your South African ID document to unlock selling on Gun Galore.',
    color: 'var(--text-tertiary)',
    showForm: true,
  },
  PENDING: {
    label: 'Under review',
    description: 'Your document has been submitted and is being reviewed by our team. This usually takes 1–2 business days.',
    color: '#f59e0b',
    showForm: false,
  },
  VERIFIED: {
    label: 'Verified',
    description: 'Your identity has been verified. You can list firearms on Gun Galore.',
    color: '#22c55e',
    showForm: false,
  },
  REJECTED: {
    label: 'Rejected',
    description: 'Your document was rejected. Please resubmit a clear photo of a valid South African ID document.',
    color: 'var(--red)',
    showForm: true,
  },
};

export default async function KycPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/kyc');

  const token = await getToken();
  const res = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const me: Me | null = res.ok ? await res.json() : null;
  const kycStatus = (me?.kycStatus ?? 'NONE') as keyof typeof STATUS_CONFIG;
  const config = STATUS_CONFIG[kycStatus];

  return (
    <main className="max-w-[560px] mx-auto px-4 py-8">
      <h1 className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        Identity Verification (KYC)
      </h1>

      {/* Status card */}
      <div
        className="rounded-[8px] p-5 mb-6"
        style={{ background: 'var(--bg-card)', border: `0.5px solid ${config.color}40` }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: config.color }}
          />
          <span className="text-sm font-medium" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {config.description}
        </p>
        {kycStatus === 'VERIFIED' && me?.kycVerifiedAt && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
            Verified on {new Date(me.kycVerifiedAt).toLocaleDateString('en-ZA')}
          </p>
        )}
      </div>

      {/* Legal context */}
      <div
        className="rounded-[6px] p-4 mb-6 text-xs leading-relaxed"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', border: '0.5px solid var(--border)' }}
      >
        <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          Why we verify your identity
        </p>
        <p>
          South African law (FICA and the Firearms Control Act) requires us to verify the identity of all users who buy or sell firearms on our platform. We collect your ID document solely for this purpose and handle it in accordance with POPIA.
        </p>
      </div>

      {config.showForm && <KycForm />}
    </main>
  );
}
