"use strict";

const enabled = (o) => !o.disabled;

function listboxReducer(state, action) {
  const { options, activeId } = state;
  const idx = options.findIndex((o) => o.id === activeId);
  const set = (patch) => ({ ...state, ...patch });

  if (action.type === "click") {
    const o = options.find((x) => x.id === action.id);
    return o && enabled(o) ? set({ activeId: o.id, selectedId: o.id }) : state;
  }
  if (action.type !== "key") return state;

  const { key, now } = action;
  const first = options.findIndex(enabled);
  let last = -1;
  options.forEach((o, i) => { if (enabled(o)) last = i; });
  const go = (i) => (i < 0 ? state : set({ activeId: options[i].id }));

  switch (key) {
    case "ArrowDown": {
      if (idx < 0) return go(first);
      const i = options.findIndex((o, j) => j > idx && enabled(o));
      return go(i);
    }
    case "ArrowUp": {
      if (idx < 0) return go(last);
      let i = -1;
      options.forEach((o, j) => { if (j < idx && enabled(o)) i = j; });
      return go(i);
    }
    case "Home": return go(first);
    case "End": return go(last);
    case "Enter":
    case " ": {
      const o = options[idx];
      return o && enabled(o) ? set({ selectedId: o.id }) : state;
    }
    case "Escape": return set({ activeId: state.selectedId });
  }

  if (key.length !== 1) return state;
  const prev = state.typeahead.buffer;
  const buffer = prev + key.toLowerCase();
  const typeahead = { buffer, at: now };
  const cycling = buffer.split("").every((c) => c === buffer[0]);
  const prefix = cycling ? buffer[0] : buffer;
  const n = options.length;
  const start = idx < 0 ? 0 : cycling ? idx + 1 : idx;
  for (let k = 0; k < n; k++) {
    const o = options[(start + k) % n];
    if (enabled(o) && o.label.toLowerCase().startsWith(prefix)) {
      return set({ activeId: o.id, typeahead });
    }
  }
  return set({ typeahead });
}

function getOptionProps(state, id) {
  const o = state.options.find((x) => x.id === id);
  return {
    role: "option",
    id,
    "aria-selected": id === state.selectedId,
    "aria-disabled": !!(o && o.disabled),
  };
}

module.exports = { listboxReducer, getOptionProps };
