// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import LoadChart from './LoadChart';

/**
 * THE BENCH — the chart with one velocity missing.
 *
 * ⚠️ A LONE DOT IN AN EMPTY GRID READS AS A BROKEN CHART. The caption was
 * hidden whenever there was no line to describe, which is exactly the moment
 * something needed saying — so the reader saw a single marker floating in a
 * frame with no explanation at all. It now names which end is missing.
 *
 * ⚠️ AND THE LINE IS DASHED. Two points is all a load carries; a solid rule
 * between them claims the ground in between was measured.
 */

const BOTH = { startGr: 35.6, startFps: 2400, maxGr: 41.5, maxFps: 2700 } as const;

describe('both velocities', () => {
  it('keeps the caption', () => {
    render(<LoadChart units="metric" {...BOTH} />);
    expect(screen.getByText('the line joins the start and max points only')).toBeInTheDocument();
  });

  it('draws the joining segment dashed', () => {
    const { container } = render(<LoadChart units="metric" {...BOTH} />);
    const line = container.querySelector('line[stroke-dasharray]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute('stroke-dasharray')).toBe('6 5');
  });

  /** The wipe moved off `.draw` — that class needs the same property the
      dashes do — but it is still a wipe, and it still collapses under
      prefers-reduced-motion (bench.css). */
  it('still draws itself in', () => {
    const { container } = render(<LoadChart units="metric" {...BOTH} />);
    expect(container.querySelector('.bench-chart-wipe')).not.toBeNull();
  });

  it('draws nothing to wipe when the animation is off', () => {
    const { container } = render(<LoadChart units="metric" {...BOTH} animate={false} />);
    expect(container.querySelector('.bench-chart-wipe')).toBeNull();
    expect(container.querySelector('line[stroke-dasharray]')).not.toBeNull();
  });
});

describe('one end without a velocity', () => {
  it('names the start when the start has none', () => {
    render(<LoadChart units="metric" {...BOTH} startFps={null} />);
    expect(screen.getByText('no velocity given for the start charge')).toBeInTheDocument();
    expect(screen.queryByText('the line joins the start and max points only')).toBeNull();
  });

  it('names the max when the max has none', () => {
    render(<LoadChart units="metric" {...BOTH} maxFps={null} />);
    expect(screen.getByText('no velocity given for the max charge')).toBeInTheDocument();
  });

  it('draws the known point and no line', () => {
    const { container } = render(<LoadChart units="metric" {...BOTH} startFps={null} />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelector('line[stroke-dasharray]')).toBeNull();
  });

  it('still labels the axis the reader is on', () => {
    render(<LoadChart units="imperial" {...BOTH} startFps={null} />);
    expect(screen.getByText('fps')).toBeInTheDocument();
  });
});

describe('neither end has a velocity', () => {
  it('says so rather than drawing an empty frame', () => {
    const { container } = render(
      <LoadChart units="metric" {...BOTH} startFps={null} maxFps={null} />,
    );
    expect(screen.getByText('No velocities for this load.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
});
