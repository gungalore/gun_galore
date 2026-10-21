'use client';

export function VideoDecisionModal({
  reason,
  onReupload,
  onReview,
  onDelete,
}: {
  reason: string;
  onReupload: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Video needs attention"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 22,
        }}
      >
        <p
          className="text-xs uppercase mb-2"
          style={{ color: 'var(--red)', letterSpacing: '0.1em', fontWeight: 500 }}
        >
          Video needs attention
        </p>
        <h2 className="text-xl mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          We could not approve this video
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {reason} Your photos are still fine. Your listing can go live with
          the photos, and the video will appear once approved if you send it for
          review. Reviews can take up to 24 hours.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onReview}
            className="w-full px-4 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', fontWeight: 500 }}
          >
            Send for admin review
          </button>
          <button
            type="button"
            onClick={onReupload}
            className="w-full px-4 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border)' }}
          >
            Upload another video
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-full px-4 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'transparent', color: 'var(--red)', border: '0.5px solid var(--border)' }}
          >
            Delete video
          </button>
        </div>
      </div>
    </div>
  );
}
