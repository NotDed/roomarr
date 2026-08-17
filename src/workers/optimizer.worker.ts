/// <reference lib="webworker" />

import { labelOptions, selectDiverse } from '@/core/archive';
import { autoArrange } from '@/core/greedy';
import { refineLayout } from '@/core/refine';
import { roomBounds } from '@/core/room';
import { scoreLayout } from '@/core/score';
import type { FromWorker, SearchOption, SearchRequest, ToWorker } from '@/workers/protocol';

/**
 * The search, off the main thread.
 *
 * Half a second of arithmetic on the main thread is half a second where the
 * plan will not redraw and a click does nothing, which reads as the app having
 * frozen rather than as it thinking. Here it costs nothing visible, progress
 * can be reported while it runs, and a cancel can actually land.
 *
 * Cancellation works because the search calls back into this file periodically
 * and the callback returns false once a cancel has arrived. A tight synchronous
 * loop could not do that — it would never yield to the message queue, so the
 * cancel would sit unread until the work it was meant to stop had finished.
 */

let cancelled = new Set<number>();

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.kind === 'cancel') {
    cancelled.add(message.runId);
    return;
  }

  if (message.kind === 'search') {
    try {
      run(message);
    } catch (error) {
      post({
        kind: 'failed',
        runId: message.runId,
        message: error instanceof Error ? error.message : 'The search failed.',
      });
    } finally {
      /* Keep the set from growing forever across a long session. */
      if (cancelled.size > 64) cancelled = new Set([message.runId]);
    }
  }
});

function post(message: FromWorker): void {
  self.postMessage(message);
}

function run(request: SearchRequest): void {
  const started = Date.now();
  const base = {
    room: request.room,
    items: request.items,
    features: request.features,
    wallIds: request.wallIds,
    roomIsSleeping: request.roomIsSleeping,
  };

  const measure = (layout: SearchRequest['layout']) => scoreLayout({ ...base, layout });

  /* Greedy first: it is quick, it lands somewhere good, and handing its answer
     to the refiner as a starting point is what makes the result never worse
     than greedy alone. */
  const greedy = autoArrange({ ...base, layout: request.layout, seed: request.seed });

  const refined = refineLayout({
    ...base,
    layout: request.layout,
    seed: request.seed,
    seeds: [greedy.layout],
    attempts: 5,
    samplePerItem: 56,
    sweeps: 4,
    ...(request.maxMoves === undefined ? {} : { maxMoves: request.maxMoves }),
    ...(request.searchCell === undefined ? {} : { searchCell: request.searchCell }),
    onProgress: (progress) => {
      if (cancelled.has(request.runId)) return false;
      post({
        kind: 'progress',
        runId: request.runId,
        attempt: progress.attempt,
        attempts: progress.attempts,
        evals: progress.evals,
      });
      return true;
    },
  });

  if (cancelled.has(request.runId)) return;

  const bounds = roomBounds(request.room);
  const picks = selectDiverse(refined.results, {
    items: request.items,
    roomDiagonal: Math.hypot(bounds.w, bounds.d),
    want: 3,
  });

  const baselineScore = measure(request.layout);

  /* Measured at the display grid, not the search grid. The number a person
     reads has to be the number the rest of the app would report for the same
     arrangement, or the two will disagree and the app will look broken. */
  const measured = picks.map((pick) => ({ pick, score: measure(pick.candidate.layout) }));

  /* Labelled from the measured figures, so "Most open floor" is true of the
     option it is attached to. */
  const labels = labelOptions(
    measured.map(({ pick, score }) => ({
      walkableMm2: score.walkableMm2,
      moved: pick.candidate.moved,
    })),
  );

  const all: SearchOption[] = measured.map(({ pick, score }, i) => {
    return {
      layout: pick.candidate.layout,
      label: labels[i] ?? 'A different arrangement',
      walkableMm2: score.walkableMm2,
      largestRectMm2: score.largestRectMm2,
      hardProblems: score.violations.filter((v) => v.severity === 'hard').length,
      softProblems: score.violations.filter((v) => v.severity === 'soft').length,
      moved: pick.candidate.moved,
      distinctness: pick.distinctness,
    };
  });

  /**
   * Only offer what is actually better, judged on the numbers that get shown.
   *
   * The search ranks on a coarse grid and the panel displays a fine one, so an
   * option can win the search and still read as worse beside the figure the
   * user is looking at. Offering someone a rearrangement of five things that
   * loses them 0.3 m² is not a suggestion, it is noise — and it undermines the
   * options that are genuinely good.
   *
   * Better means more floor, or the same floor with fewer problems. Anything
   * that moves nothing is not a suggestion at all.
   */
  const MEANINGFUL = 50_000; // 0.05 m²; below this is measurement noise
  const options = all.filter(
    (option) =>
      option.moved.length > 0 &&
      (option.walkableMm2 > baselineScore.walkableMm2 + MEANINGFUL ||
        option.hardProblems < baselineScore.violations.filter((v) => v.severity === 'hard').length),
  );

  post({
    kind: 'result',
    runId: request.runId,
    options,
    baseline: {
      walkableMm2: baselineScore.walkableMm2,
      hardProblems: baselineScore.violations.filter((v) => v.severity === 'hard').length,
      softProblems: baselineScore.violations.filter((v) => v.severity === 'soft').length,
    },
    /* Decided from the filtered set, not from the search's own bookkeeping, so
       "nothing worth moving" and "here are three options" cannot both be true
       of the same run. */
    keptOriginal: options.length === 0 && baselineScore.feasible,
    evals: refined.evals,
    ms: Date.now() - started,
  });
}
