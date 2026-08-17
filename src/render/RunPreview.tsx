import { useMemo } from 'react';
import { boundingRectOfPoints } from '@/core/geometry';
import { type DisplayUnit, formatLength } from '@/core/units';
import { type WallRun, traceRun } from '@/core/wallrun';
import { fitProjector, geometryTransform, sw, toPaper } from '@/render/projector';

/**
 * Draws a wall run that does not (yet) close.
 *
 * Blanking the drawing whenever the run is momentarily invalid would be the
 * obvious thing to do and the wrong one: the run is invalid for most of the
 * time someone spends typing it, and watching your room vanish because you
 * mistyped a digit is how a form stops being trusted. So the polyline is drawn
 * as far as it goes, and the closure gap is drawn as an explicit dashed line
 * with its size on it — turning the error into the most legible thing on
 * screen instead of an absence.
 */
export function RunPreview({
  run,
  width,
  height,
  unit,
}: {
  run: WallRun;
  width: number;
  height: number;
  unit: DisplayUnit;
}) {
  const traced = useMemo(() => traceRun(run), [run]);

  const end = useMemo(
    () => ({
      x: run.start.x + traced.residual.x,
      y: run.start.y + traced.residual.y,
    }),
    [run.start, traced.residual],
  );

  const points = useMemo(() => [...traced.vertices, end], [traced.vertices, end]);
  const projector = useMemo(
    () => fitProjector(boundingRectOfPoints(points), { width, height }, 56),
    [points, width, height],
  );

  if (points.length < 2) return null;

  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${v.x} ${v.y}`).join(' ');
  const startPaper = toPaper(projector, run.start);
  const endPaper = toPaper(projector, end);
  const gapMid = { x: (startPaper.x + endPaper.x) / 2, y: (startPaper.y + endPaper.y) / 2 };

  return (
    <svg
      className="plan plan--open"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Floor plan, walls do not close yet"
    >
      <g transform={geometryTransform(projector)}>
        <path className="plan__wall plan__wall--open" d={path} strokeWidth={sw(projector, 2.5)} />
      </g>

      {/* The gap, drawn rather than merely described. */}
      <line
        className="plan__gap"
        x1={startPaper.x}
        y1={startPaper.y}
        x2={endPaper.x}
        y2={endPaper.y}
      />
      <circle className="plan__gapdot" cx={startPaper.x} cy={startPaper.y} r={3.5} />
      <circle className="plan__gapdot" cx={endPaper.x} cy={endPaper.y} r={3.5} />
      <text className="plan__gaptext" x={gapMid.x} y={gapMid.y - 8} textAnchor="middle">
        {formatLength(Math.round(Math.hypot(traced.residual.x, traced.residual.y)), unit)} {unit}{' '}
        short
      </text>
    </svg>
  );
}
