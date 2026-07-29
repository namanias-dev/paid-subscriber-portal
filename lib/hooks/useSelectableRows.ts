"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Shared select-all / prune pattern for At-Risk worklists.
 * Select-all only touches currently visible + selectable ids — never the
 * whole unfiltered table, and never rows staff cannot message.
 */
export function useSelectableRows(visibleSelectableIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleSet = useMemo(() => new Set(visibleSelectableIds), [visibleSelectableIds]);

  // Drop anything that left the filtered/selectable set.
  useEffect(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleSet]);

  const toggleRow = useCallback((id: string) => {
    if (!visibleSet.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [visibleSet]);

  const allSelected =
    visibleSelectableIds.length > 0
    && visibleSelectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visibleSelectableIds));
  }, [visibleSelectableIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const toggleAllVisible = useCallback(() => {
    if (allSelected) clear();
    else selectAllVisible();
  }, [allSelected, clear, selectAllVisible]);

  const selectedVisibleIds = useMemo(
    () => [...selected].filter((id) => visibleSet.has(id)),
    [selected, visibleSet],
  );

  return {
    selected,
    selectedVisibleIds,
    toggleRow,
    toggleAllVisible,
    clear,
    allSelected,
    someSelected,
  };
}
