'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { capturePageScreenshot, currentPageUrl } from './capture';
import { BugReportModal } from './bug-report-modal';

interface BugReportContextValue {
  /** Open the report sheet, capturing the current page first. */
  open: () => void;
}

// A no-op default rather than `null`: AccountMenuList (a client component that
// also renders outside this provider in some trees/tests) calls `useBugReport`
// unconditionally, and a missing provider must not throw.
const BugReportContext = createContext<BugReportContextValue>({ open: () => {} });

export function useBugReport(): BugReportContextValue {
  return useContext(BugReportContext);
}

export function BugReportProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [capturing, setCapturing] = useState(false);

  const open = useCallback(() => {
    setUrl(currentPageUrl());
    setScreenshot(null);
    setCapturing(true);
    setIsOpen(true);
    // Fire-and-forget: a null result just means the report goes without one.
    void capturePageScreenshot().then((file) => {
      setScreenshot(file);
      setCapturing(false);
    });
  }, []);

  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <BugReportContext.Provider value={value}>
      {children}
      {isOpen && (
        <BugReportModal
          url={url}
          screenshot={screenshot}
          capturing={capturing}
          onScreenshotChange={setScreenshot}
          onClose={close}
        />
      )}
    </BugReportContext.Provider>
  );
}
