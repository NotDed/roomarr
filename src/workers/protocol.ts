import type { Feature } from '@/core/features';
import type { Item, Layout } from '@/core/items';
import type { Room } from '@/core/room';
import type { Mm } from '@/core/units';
import type { WallId } from '@/core/wallrun';

/**
 * What the main thread and the search worker say to each other.
 *
 * Five message kinds and a discriminated union, rather than a wrapper library.
 * The protocol needs streamed progress and cancellation, which is the awkward
 * part of any RPC abstraction anyway, and forty lines of explicit types is
 * clearer than configuring something general.
 *
 * Everything crossing the boundary is plain data. The room, items and layout
 * are already plain objects with no methods or class instances, so they survive
 * structured clone unchanged — a property worth keeping deliberately rather
 * than discovering the hard way.
 */

export interface SearchRequest {
  kind: 'search';
  /** Identifies this run, so a late reply from a cancelled one is ignored. */
  runId: number;
  room: Room;
  items: Item[];
  layout: Layout;
  features: Feature[];
  wallIds: WallId[];
  roomIsSleeping: boolean;
  seed: number;
  /** Cap on how many things may move, or undefined for no cap. */
  maxMoves?: number;
  searchCell?: Mm;
}

export interface CancelRequest {
  kind: 'cancel';
  runId: number;
}

export type ToWorker = SearchRequest | CancelRequest;

export interface ProgressMessage {
  kind: 'progress';
  runId: number;
  attempt: number;
  attempts: number;
  evals: number;
}

/** One arrangement worth showing, already scored and named. */
export interface SearchOption {
  layout: Layout;
  label: string;
  walkableMm2: number;
  largestRectMm2: number;
  hardProblems: number;
  softProblems: number;
  moved: string[];
  /** How unlike the better-scoring options this one is, 0–1. */
  distinctness: number;
}

export interface ResultMessage {
  kind: 'result';
  runId: number;
  options: SearchOption[];
  /** The layout it started from, measured the same way. */
  baseline: { walkableMm2: number; hardProblems: number; softProblems: number };
  keptOriginal: boolean;
  evals: number;
  ms: number;
}

export interface FailureMessage {
  kind: 'failed';
  runId: number;
  message: string;
}

export type FromWorker = ProgressMessage | ResultMessage | FailureMessage;
