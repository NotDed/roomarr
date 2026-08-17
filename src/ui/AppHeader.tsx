/**
 * The headline metric sits in the header from the very first milestone, before
 * anything can compute it. It is the number this entire app exists to move, and
 * giving it a permanent home means every later feature is visibly in service of
 * it rather than competing for the same space.
 */
export function AppHeader() {
  return (
    <header className="header">
      <div className="header__brand">
        <h1 className="header__title">roomarr</h1>
        <span className="header__tagline">rearrange for walkable floor</span>
      </div>

      <div className="header__spacer" />

      <div className="metric metric--idle">
        <span className="metric__label">Walkable</span>
        <span className="metric__value num">— m²</span>
      </div>
    </header>
  );
}
