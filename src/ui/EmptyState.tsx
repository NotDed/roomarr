/**
 * Shown only before a room exists. Once one does, the stage always draws
 * something — a closed room, or the open polyline of a run still being typed.
 */
export function EmptyState() {
  return (
    <div className="empty">
      <h2 className="empty__title">Let's measure your room</h2>
      <p className="empty__lede">
        Put in the overall width and depth on the right and it will be drawn to scale. Then work
        wall by wall, clockwise, adding alcoves and returns until the outline matches the room you
        are standing in.
      </p>
      <p className="empty__lede">
        Everything runs here in your browser — nothing is uploaded. No measurement you type is
        treated as fixed, and no preset is a limit; every number stays yours to change.
      </p>
      <p className="empty__note">
        Next: doors and windows, then your furniture, then the walkable-floor figure this whole
        thing is for.
      </p>
    </div>
  );
}
