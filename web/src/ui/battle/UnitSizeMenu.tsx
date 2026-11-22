import { useState, useSyncExternalStore } from "react";
import {
  setUnitClassScale,
  subscribeUnitScales,
  UNIT_SCALE_MAX,
  UNIT_SCALE_MIN,
  UNIT_SIZE_GROUPS,
  unitScales,
} from "./unitScaleSettings";
import type { UnitType } from "./combatTypes";

/** Class sizes for the battle menu. One percentage covers every faction of that class. */
export function UnitSizeMenu() {
  const scales = useSyncExternalStore(subscribeUnitScales, unitScales, unitScales);
  const [draft, setDraft] = useState<Partial<Record<UnitType, string>>>({});

  const clearDraft = (type: UnitType) => {
    setDraft((current) => {
      if (current[type] == null) return current;
      const next = { ...current };
      delete next[type];
      return next;
    });
  };

  return (
    <div className="w-full rounded-lg border border-[#5E4E54] bg-[#2b242a] p-2 text-left">
      <div className="mb-1 text-[10px] font-bold tracking-wider text-[#A69C90]">UNIT SIZE</div>
      <div className="max-h-44 overflow-y-auto pr-1">
        {UNIT_SIZE_GROUPS.map((group) => (
          <div key={group.title} className="mb-2 last:mb-0">
            <div className="text-[10px] font-bold text-[#CAA574]">{group.title}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {group.types.map((row) => (
                <label key={row.type} className="flex items-center justify-between gap-1 text-[11px] text-[#DFCE91]">
                  {row.label}
                  <span className="flex items-center gap-0.5">
                    <input
                      aria-label={`${row.label} size`}
                      type="number"
                      min={UNIT_SCALE_MIN}
                      max={UNIT_SCALE_MAX}
                      step={5}
                      value={draft[row.type] ?? String(scales[row.type])}
                      onChange={(event) => {
                        const text = event.target.value;
                        setDraft((current) => ({ ...current, [row.type]: text }));
                        const next = Number(text);
                        if (next >= UNIT_SCALE_MIN && next <= UNIT_SCALE_MAX) setUnitClassScale(row.type, next);
                      }}
                      onBlur={(event) => {
                        setUnitClassScale(row.type, Number(event.currentTarget.value));
                        clearDraft(row.type);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="w-14 bg-[#423840] border border-[#5E4E54] rounded px-1 py-0.5 text-right text-[#DFCE91]"
                    />
                    <span className="text-[#A69C90]">%</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
