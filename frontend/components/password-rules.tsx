'use client';

import { PASSWORD_RULES } from '@/lib/password-rule';

/**
 * The password rule, spelled out, with each line ticked as the member meets
 * it. Goes inside the <HelpTip/> beside a password label.
 *
 * ⚠️ THIS IS THE LONG FORM, NOT THE ONLY FORM. The one-line `PASSWORD_HINT`
 * stays visible under the field. A rule a member can only discover by opening
 * a tooltip is a rule they meet by trial and error at the point of submitting.
 *
 * ⚠️ THE TICK IS NEVER THE ONLY SIGNAL. Each row carries its state in text
 * for screen readers (`aria-label`) as well as in the colour of the mark,
 * because "done" and "not done" rendered only as green and grey is the
 * commonest way a checklist stops existing for a colour-blind reader.
 */
export function PasswordRulesTip({ password }: { password: string }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {PASSWORD_RULES.map((rule) => {
        const met = rule.ok(password);
        return (
          <li
            key={rule.label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              marginBottom: 3,
              color: met ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            <span
              aria-label={met ? 'Done:' : 'Still needed:'}
              style={{
                flex: '0 0 auto',
                width: 12,
                lineHeight: 1.55,
                color: met ? 'var(--red)' : 'var(--text-faint)',
              }}
            >
              {met ? '✓' : '•'}
            </span>
            <span>{rule.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
