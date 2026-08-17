# roomarr

A browser sandbox for rearranging a real room. Enter your room's dimensions, its doors, windows
and wall-mounted TV, and your actual furniture with its actual sizes — then let it find an
arrangement that maximizes **free walkable area**, and print a blueprint you can carry around
with a tape measure while you move things.

No backend, no account, no upload. Everything runs in your browser.

> **Status:** usable end to end. Measure a room, place your doors, windows and furniture,
> see what's wrong with it in plain sentences, and press one button to get a better
> arrangement — which it will decline to give you if what you have is already the best it
> found. Still to come: magnetic snapping, saved arrangements, a side-by-side compare, and
> the printable blueprint. See [milestones](#milestones).

---

## The thesis: "free floor area" is a constant, and that nearly kills the idea

The obvious way to score a room layout is to add up the floor that isn't covered by furniture.
It does not work, and it fails in a way that is easy to miss:

```
FreeArea = Area(room) − Σ Area(footprint)
```

For a fixed room and a fixed set of non-overlapping furniture, **that expression has no
dependence on where anything is.** Shove everything into one corner, spread it evenly, stack it
along a wall — the number is identical every time. Every legal arrangement ties for first place.
An optimizer built on it returns noise.

Floor area only becomes a meaningful objective after three transformations:

1. **Erode** the free floor by a human body radius (350 mm by default → a 700 mm passage).
   A 200 mm strip between the bed and the wall is floor, but nobody walks there.
2. **Keep only what's reachable** from the doorway, using 4-connectivity. Floor sealed behind a
   wardrobe is not walkable, however open it looks on a plan.
3. **Dilate back.** This step is the one everyone forgets. Report the _opening_, not the
   erosion — otherwise a 900 mm corridor gets measured as 200 mm and every corridor in the room
   is undercounted by ~78%.

Formally, with `P` the room, `O` the obstacles, `B_r` a disc of the body radius, and `T` the
doorway:

```
F = P \ O                       free floor
C = F ⊖ B_r                     where the centre of a body can be
R = components of C touching T  ... and can actually get to
W = (R ⊕ B_r) ∩ F               the floor a reachable body covers   ← walkable area
```

After that, walkable area swings by 3–4 m² in a 14 m² bedroom depending purely on arrangement.
That swing is the entire product.

**Clearance zones are not obstacles.** The 700 mm you need beside the bed to get into it _is_
walkable floor, and you walk through a doorway constantly. Zones constrain where _furniture_ may
go; they never subtract from where a _person_ may walk. Conflating the two roughly halves the
measured area and produces layouts nobody would accept.

More detail — including what each soft scoring term is worth in m² of floor — will live in
[`METRIC.md`](./METRIC.md).

---

## What it does

- **Rooms that aren't rectangles.** Rectilinear polygons with 90° corners, so alcoves, L-shapes,
  chimney breasts and bay templates all work.
- **Your measurements, not a catalogue's.** Presets prefill a bed or a wardrobe with plausible
  dimensions; every one of those numbers is editable, and you can author a fully custom item with
  custom clearance rules. Nothing is locked.
- **Ergonomics as hard constraints.** Door swings stay clear, wardrobe doors get room to open,
  the headboard goes against a wall, tall furniture doesn't blind a window, the TV stays in a
  sane viewing band. Layouts that break these are rejected, not merely penalized.
- **A move budget, not a mystery.** "Move at most 3 things" is a slider, so the tool can propose
  a small tweak instead of an unusable full teardown.
- **A blueprint that survives contact with a tape measure.** Every position is printed as two
  gaps from a named corner, plus a cross-check and a squareness pair, plus an ordered move list
  that can't deadlock when two items need to swap places.

## What it deliberately does not do

No 3D. No retailer catalogue or IKEA import. No photogrammetry, LiDAR or AR capture. No curved or
oblique walls. No multi-room planning. No backend of any kind. Height is data used for light,
sightlines and tuck-under — it is never rendered.

---

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + format + tests — run this before committing
npm test
npm run build
```

`src/core/` is a zero-dependency, DOM-free, React-free, deterministic TypeScript library — the
room geometry, the walkable-area metric, the constraint set, the optimizer and the blueprint
generator all live there, and every one of them is unit-testable without a browser. Everything
under `src/render/`, `src/ui/` and `src/state/` is a view over it.

That boundary is enforced two ways, both of which have to keep passing:

- `tsconfig.core.json` typechecks `src/core` with no DOM and no JSX in `lib`, so a stray
  `document` reference fails to compile there even though it compiles fine in the app.
- [`tests/core-boundary.test.ts`](./tests/core-boundary.test.ts) reads every core source file and
  rejects npm imports, node builtins, host globals, `Math.random`, `Date.now` and
  `performance.now`. It's a test rather than a lint rule because a lint rule is one
  `disable-next-line` away from being off, and the damage from breaking this — a metric that
  depends on wall-clock time, or a solve that can't be replayed from its seed — surfaces as flaky
  numbers rather than as an error.

## Milestones

- [x] **M0** — repo, rails, app shell
- [x] **M1** — units, geometry, room entry as a wall run
- [x] **M2** — doors, windows, fixtures, furniture, your current arrangement
- [x] **M3** — the walkable-area metric, live while you drag, with a heat overlay
- [x] **M4** — constraints and violations in plain sentences
- [x] **M5** — greedy auto-arrange
- [ ] **M6** — simulated annealing in a worker, plus a fixture bench
- [ ] **M7** — three labelled options, move budget, per-item locks
- [ ] **M8** — the printable blueprint and the move plan
- [ ] **M9** — import/export, sample rooms, onboarding

## License

MIT — see [LICENSE](./LICENSE).
