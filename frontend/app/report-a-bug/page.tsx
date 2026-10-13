'use client';

// Direct-URL fallback for "Report a bug". The primary entry points (the bottom
// tray tab and the desktop hovering button) open the global capture sheet; this
// page exists so a link from anywhere still works. It captures its own URL and
// page, then renders the same shared form.

import { useEffect, useState } from 'react';
import {
  capturePageScreenshot,
  currentPageUrl,
} from '@/components/bug-report/capture';
import { BugReportForm } from '@/components/bug-report/bug-report-form';

export default function ReportBugPage() {
  const [url, setUrl] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [capturing, setCapturing] = useState(true);

  useEffect(() => {
    setUrl(currentPageUrl());
    let cancelled = false;
    void capturePageScreenshot().then((file) => {
      if (cancelled) return;
      setScreenshot(file);
      setCapturing(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        Report a bug
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mt-1 mb-4">
        Found something broken? Tell us what happened and we&apos;ll fix it.
      </p>
      <BugReportForm
        url={url}
        screenshot={screenshot}
        capturing={capturing}
        onScreenshotChange={setScreenshot}
      />
    </div>
  );
}
