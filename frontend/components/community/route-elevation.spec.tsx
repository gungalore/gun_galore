// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteElevation } from './route-elevation';

const points = [
  { distM: 0, ele: 100 },
  { distM: 1000, ele: 200 },
  { distM: 2000, ele: 150 },
];

function mockSvgRect(container: HTMLElement, width = 100) {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('chart svg not rendered');
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: 140,
      width,
      height: 140,
      toJSON: () => ({}),
    }) as DOMRect;
  return svg as SVGSVGElement;
}

describe('RouteElevation', () => {
  it('says so when the GPX has no elevation, but still offers point selection', () => {
    const { container } = render(
      <RouteElevation
        points={[{ distM: 0, ele: null }, { distM: 1000, ele: null }]}
        selectedIndex={0}
        onSelect={vi.fn()}
        hasElevation={false}
      />,
    );
    expect(screen.getByText('No elevation data in this GPX.')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
    // Speed and gradient can still exist without elevation, so the scrubber
    // must survive; without it the no-map fallback would have no point picker.
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('renders an accessible chart with min and max labels', () => {
    const { container } = render(
      <RouteElevation
        points={points}
        selectedIndex={0}
        onSelect={vi.fn()}
        hasElevation
      />,
    );
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toContain('100 m');
    expect(chart.getAttribute('aria-label')).toContain('200 m');
    expect(container.textContent).toContain('max');
    expect(container.textContent).toContain('min');
  });

  it('marks the selected point with a crosshair and a dot', () => {
    render(
      <RouteElevation points={points} selectedIndex={1} onSelect={vi.fn()} hasElevation />,
    );
    const dot = screen.getByTestId('route-elevation-dot');
    // y for 200 m is the top of the profile; x for 1000 m is halfway.
    expect(dot.style.left).toBe('50%');
    expect(dot.style.top).toBe('6%');
    expect(screen.getByTestId('route-elevation-crosshair').style.left).toBe('50%');
  });

  it('moves the selection from the range input (keyboard path)', async () => {
    const onSelect = vi.fn();
    render(
      <RouteElevation points={points} selectedIndex={0} onSelect={onSelect} hasElevation />,
    );
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-label')).toBe('Route point');
    expect(slider.getAttribute('aria-valuetext')).toContain('0 m');
    await userEvent.click(slider);
    fireEvent.change(slider, { target: { value: '2' } });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('selects the nearest sample on a pointer move across the chart', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RouteElevation points={points} selectedIndex={0} onSelect={onSelect} hasElevation />,
    );
    const svg = mockSvgRect(container);
    fireEvent.pointerMove(svg, { clientX: 60, pointerType: 'mouse', buttons: 0 });
    expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.pointerDown(svg, { clientX: 99, pointerType: 'mouse', buttons: 1 });
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it('clamps an out-of-range selectedIndex instead of rendering a broken dot', () => {
    render(
      <RouteElevation points={points} selectedIndex={99} onSelect={vi.fn()} hasElevation />,
    );
    // Falls back to the nearest sample already on the chart.
    expect(screen.getByTestId('route-elevation-dot').style.left).toBe('100%');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('2');
  });
});
