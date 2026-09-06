import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface TopBarProps {
  left?: { icon: IconName; label?: string; onClick: () => void; aria: string };
  right?: { icon: IconName; label?: string; onClick: () => void; aria: string };
  title?: ReactNode;
}

export function TopBar({ left, right, title }: TopBarProps): ReactElement {
  return (
    <div className="aos-top">
      {left ? (
        <button type="button" className="aos-top-side" onClick={left.onClick} aria-label={left.aria}>
          <Icon name={left.icon} />
          {left.label ? <span>{left.label}</span> : null}
        </button>
      ) : (
        <span className="aos-top-side" aria-hidden="true" />
      )}
      <div className="aos-top-mid">{title}</div>
      {right ? (
        <button type="button" className="aos-top-side aos-right" onClick={right.onClick} aria-label={right.aria}>
          {right.label ? <span>{right.label}</span> : null}
          <Icon name={right.icon} />
        </button>
      ) : (
        <span className="aos-top-side" aria-hidden="true" />
      )}
    </div>
  );
}
