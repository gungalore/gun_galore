import { useCallback, useRef, type ReactElement } from 'react';

/**
 * The "choose from photos or files" path. One hidden input with no `capture`
 * attribute: iPhone then offers Photo Library, Take Photo and Choose File;
 * Android shows its picker with Files, Gallery and Camera. PDFs are accepted
 * because the website accepts them and members are sent PDFs by email.
 */
export const PICK_ACCEPT = 'image/*,application/pdf,.pdf';

export function usePickFiles(onFiles: (files: File[]) => void): { input: ReactElement; open: () => void } {
  const ref = useRef<HTMLInputElement>(null);
  const open = useCallback(() => ref.current?.click(), []);
  const input = (
    <input
      ref={ref}
      className="aos-hidden-input"
      type="file"
      accept={PICK_ACCEPT}
      multiple
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        // Reset so picking the same photo twice still fires a change event.
        e.currentTarget.value = '';
        if (files.length) onFiles(files);
      }}
    />
  );
  return { input, open };
}
