import { useState } from 'react';
import { PRESETS, presetFor } from '@/core/catalog';
import type { ClearanceRule, Item, ItemType, Placement } from '@/core/items';
import { type DisplayUnit, formatLength, parseLength } from '@/core/units';
import { selectActiveLayout, useStore } from '@/state/store';

/**
 * Your furniture, at your sizes.
 *
 * Two fields are visible by default — the name and the footprint — because
 * those are the two a person actually knows without going to measure. Height,
 * clearances and the rest sit behind "More", and none of them is asked for
 * until something depends on it. A form that demands fifteen numbers before
 * showing anything gets abandoned.
 */
export function ItemPanel() {
  const room = useStore((s) => s.room);
  const unit = useStore((s) => s.unit);
  const items = useStore((s) => s.items);
  const layout = useStore(selectActiveLayout);
  const selectedId = useStore((s) => s.selectedItemId);

  const addItem = useStore((s) => s.addItem);
  const removeItem = useStore((s) => s.removeItem);
  const selectItem = useStore((s) => s.selectItem);

  const [picking, setPicking] = useState(false);

  if (room === null) {
    return (
      <>
        <h2 className="panel__title">Furniture</h2>
        <p className="panel__empty">Measure the room first.</p>
      </>
    );
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const placement = layout.placements.find((p) => p.itemId === selectedId) ?? null;

  return (
    <>
      <div className="roomform__head">
        <h2 className="panel__title">Furniture</h2>
        <button className="linkbtn" type="button" onClick={() => setPicking(!picking)}>
          {picking ? 'close' : '+ add'}
        </button>
      </div>

      {picking && (
        <div className="picker">
          {PRESETS.map((preset) => (
            <div className="picker__group" key={preset.type}>
              <span className="picker__label">{preset.label}</span>
              <div className="picker__variants">
                {preset.variants.map((variant, index) => (
                  <button
                    key={variant.label}
                    className="chip"
                    type="button"
                    onClick={() => {
                      addItem(preset.type as ItemType, index);
                      setPicking(false);
                    }}
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="panel__empty">Nothing in the room yet.</p>
      ) : (
        <ul className="featlist">
          {items.map((item) => {
            const p = layout.placements.find((q) => q.itemId === item.id);
            return (
              <li
                key={item.id}
                className={
                  item.id === selectedId ? 'featlist__row featlist__row--on' : 'featlist__row'
                }
              >
                <button
                  className="featlist__pick"
                  type="button"
                  onClick={() => selectItem(item.id === selectedId ? null : item.id)}
                >
                  <span className="featlist__name">
                    {item.name}
                    {p?.locked === true && <em> · pinned</em>}
                  </span>
                  <span className="featlist__where num">
                    {formatLength(item.footprint.w, unit)} × {formatLength(item.footprint.d, unit)}{' '}
                    {unit}
                  </span>
                </button>
                <button
                  className="iconbtn"
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeItem(item.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected !== null && placement !== null && (
        <ItemEditor item={selected} placement={placement} unit={unit} />
      )}
    </>
  );
}

function ItemEditor({
  item,
  placement,
  unit,
}: {
  item: Item;
  placement: Placement;
  unit: DisplayUnit;
}) {
  const updateItem = useStore((s) => s.updateItem);
  const rotateItem = useStore((s) => s.rotateItem);
  const nudgeItem = useStore((s) => s.nudgeItem);
  const moveItem = useStore((s) => s.moveItem);
  const toggleItemLock = useStore((s) => s.toggleItemLock);
  const [more, setMore] = useState(false);

  const preset = presetFor(item.type);

  return (
    <div className="feateditor">
      <div className="field">
        <label htmlFor="item-name">Name</label>
        <input
          id="item-name"
          className="field__input"
          value={item.name}
          onChange={(e) => updateItem(item.id, { name: e.target.value })}
        />
      </div>

      <div className="field field--pair">
        <label htmlFor="item-w">Size</label>
        <MmInput
          id="item-w"
          aria="Width"
          value={item.footprint.w}
          unit={unit}
          onCommit={(w) => updateItem(item.id, { footprint: { ...item.footprint, w } })}
        />
        <span className="field__times">×</span>
        <MmInput
          id="item-d"
          aria="Depth"
          value={item.footprint.d}
          unit={unit}
          onCommit={(d) => updateItem(item.id, { footprint: { ...item.footprint, d } })}
        />
        <span className="field__unit">{unit}</span>
      </div>

      {/* Numeric placement lands before drag on purpose: the app has to be
          fully usable without a mouse gesture, and a keyboard-only path is
          also how someone types a measurement they took off the floor. */}
      <div className="field field--pair">
        <label htmlFor="item-x">At</label>
        <MmInput
          id="item-x"
          aria="Distance across"
          value={placement.pose.x}
          unit={unit}
          onCommit={(x) => moveItem(item.id, { ...placement.pose, x })}
        />
        <span className="field__times">,</span>
        <MmInput
          id="item-y"
          aria="Distance down"
          value={placement.pose.y}
          unit={unit}
          onCommit={(y) => moveItem(item.id, { ...placement.pose, y })}
        />
        <span className="field__unit">{unit}</span>
      </div>

      <div className="btnrow">
        <button className="btn" type="button" onClick={() => rotateItem(item.id, 1)}>
          Turn ¼
        </button>
        <button className="btn" type="button" onClick={() => nudgeItem(item.id, -10, 0)}>
          ←
        </button>
        <button className="btn" type="button" onClick={() => nudgeItem(item.id, 10, 0)}>
          →
        </button>
        <button className="btn" type="button" onClick={() => nudgeItem(item.id, 0, -10)}>
          ↑
        </button>
        <button className="btn" type="button" onClick={() => nudgeItem(item.id, 0, 10)}>
          ↓
        </button>
      </div>

      <label className="checkline">
        <input
          type="checkbox"
          checked={placement.locked}
          onChange={() => toggleItemLock(item.id)}
        />
        Keep this where it is
      </label>

      <button className="linkbtn" type="button" onClick={() => setMore(!more)}>
        {more ? 'less' : 'more…'}
      </button>

      {more && (
        <>
          <MmField
            id="item-h"
            label="Height"
            value={item.height}
            unit={unit}
            onCommit={(height) => updateItem(item.id, { height })}
            hint="Only matters near a window or a wall-mounted TV."
          />

          {item.type === 'bed' && (
            <div className="field">
              <label htmlFor="item-occ">Sleepers</label>
              <select
                id="item-occ"
                className="field__input"
                value={item.occupants ?? 2}
                onChange={(e) =>
                  updateItem(item.id, { occupants: Number(e.target.value) === 1 ? 1 : 2 })
                }
              >
                <option value={1}>One — one side is enough</option>
                <option value={2}>Two — needs both sides</option>
              </select>
            </div>
          )}

          <label className="checkline">
            <input
              type="checkbox"
              checked={item.mustTouchWall}
              onChange={(e) => updateItem(item.id, { mustTouchWall: e.target.checked })}
            />
            Has to be against a wall
          </label>

          {/* The edit that matters most. A wardrobe with sliding doors needs
              600 in front, not 900, and being unable to say so is how a tool
              declares a workable room unworkable. */}
          {item.clearances.length > 0 && (
            <div className="clearances">
              <span className="clearances__title">Space it needs around it</span>
              {item.clearances.map((rule) => (
                <ClearanceField key={rule.id} itemId={item.id} rule={rule} unit={unit} />
              ))}
              <button
                className="linkbtn"
                type="button"
                onClick={() =>
                  updateItem(item.id, { clearances: preset.clearances(item.footprint) })
                }
              >
                reset to the usual figures
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClearanceField({
  itemId,
  rule,
  unit,
}: {
  itemId: string;
  rule: ClearanceRule;
  unit: DisplayUnit;
}) {
  const updateClearance = useStore((s) => s.updateClearance);

  return (
    <div className="clearance">
      <div className="field">
        <label htmlFor={`c-${rule.id}`}>{sideLabel(rule.side)}</label>
        <MmInput
          id={`c-${rule.id}`}
          aria={`${sideLabel(rule.side)} clearance`}
          value={rule.depth}
          unit={unit}
          onCommit={(depth) => updateClearance(itemId, rule.id, { depth })}
        />
        <span className="field__unit">{unit}</span>
      </div>
      <p className="clearance__why">{rule.reason}</p>
    </div>
  );
}

function sideLabel(side: ClearanceRule['side']): string {
  switch (side) {
    case 'front':
      return 'In front';
    case 'back':
      return 'Behind';
    case 'left':
      return 'Left';
    case 'right':
      return 'Right';
  }
}

function MmInput({
  id,
  aria,
  value,
  unit,
  onCommit,
}: {
  id: string;
  aria: string;
  value: number;
  unit: DisplayUnit;
  onCommit: (mm: number) => void;
}) {
  return (
    <input
      id={id}
      aria-label={aria}
      className="num field__input field__input--short"
      inputMode="decimal"
      key={`${id}-${value}-${unit}`}
      defaultValue={formatLength(value, unit)}
      onBlur={(e) => {
        const parsed = parseLength(e.target.value, unit);
        if (parsed !== null) onCommit(parsed);
        else e.target.value = formatLength(value, unit);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function MmField({
  id,
  label,
  value,
  unit,
  onCommit,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  unit: DisplayUnit;
  onCommit: (mm: number) => void;
  hint?: string;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <MmInput id={id} aria={label} value={value} unit={unit} onCommit={onCommit} />
        <span className="field__unit">{unit}</span>
      </div>
      {hint !== undefined && <p className="hint">{hint}</p>}
    </>
  );
}
