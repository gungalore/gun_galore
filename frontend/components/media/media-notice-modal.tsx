'use client';

export function MediaNoticeModal({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 91,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 22,
        }}
      >
        <h2 className="text-lg mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {title}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {body}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', fontWeight: 500 }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
