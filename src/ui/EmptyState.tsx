/**
 * The two entry modes are shown from the first milestone because which one a
 * person picks changes what the app has to ask them for, and that decision is
 * the single biggest lever on whether they ever reach a suggestion.
 *
 * "Just give me ideas" needs a room, a door, and a list of what's in it — no
 * current positions at all, which is roughly three minutes of typing. Asking
 * for the current arrangement up front is 20+ minutes of work, and it is only
 * genuinely needed for the move budget and the move plan.
 *
 * Neither is wired up yet; room entry arrives in M1.
 */
export function EmptyState() {
  return (
    <div className="empty">
      <h2 className="empty__title">Let's measure your room</h2>
      <p className="empty__lede">
        Everything runs here in your browser. Nothing is uploaded, and no measurement you type is
        treated as fixed — presets only fill in a starting guess.
      </p>

      <div className="empty__choices">
        <button className="choice" type="button" disabled>
          <span className="choice__name">Just give me ideas</span>
          <span className="choice__hint">
            Your room, its door, and a list of your furniture. About three minutes.
          </span>
        </button>

        <button className="choice" type="button" disabled>
          <span className="choice__name">Improve the room I have</span>
          <span className="choice__hint">
            Also place things where they sit today, so it can suggest a small change and print a
            move list.
          </span>
        </button>
      </div>

      <p className="empty__note">
        Not wired up yet — room entry lands in the next milestone. Follow along in the README.
      </p>
    </div>
  );
}
