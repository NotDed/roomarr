import type { ReactNode } from 'react';

/**
 * The drawing surface. From M1 this holds the room SVG — the same components
 * that later render the printed sheets, so what gets printed cannot drift from
 * what was approved on screen.
 */
export function Stage({ children }: { children?: ReactNode }) {
  return (
    <div className="stage" role="region" aria-label="Floor plan">
      {children}
    </div>
  );
}
