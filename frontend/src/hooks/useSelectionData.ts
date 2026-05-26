// =============================================================================
// 🪝 frontend/src/hooks/useSelectionData.ts
// =============================================================================
//
// Iz surove SelectionState (indeksi ćelija) izvodi kalkulisani SelData
// (datumi, px pozicije, totalDays) koji se direktno koristi u modalima.
//
// Izdvojen iz BookingCalendar jer je ovo čista transformacija podataka
// bez side-effecta — idealna za hook.
// =============================================================================

import { useMemo } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { SelectionState, SelData } from '../types/ui';
import type { Apartment } from '../../../shared/index';

interface UseSelectionDataProps {
  selection: SelectionState | null;
  days: Date[];
  dayW: number;
  apartments: Apartment[];
}

export function useSelectionData({
  selection,
  days,
  dayW,
  apartments,
}: UseSelectionDataProps): SelData | null {
  return useMemo<SelData | null>(() => {
    if (!selection) return null;

    const lo = Math.min(selection.startIndex, selection.endIndex);
    const hi = Math.max(selection.startIndex, selection.endIndex);
    const sd = days[lo];
    const ed = days[hi];
    if (!sd || !ed) return null;

    const aptIdx = apartments.findIndex((a) => a.id === selection.apartmentId);

    return {
      startDate: sd,
      endDate: ed,
      totalDays: differenceInCalendarDays(ed, sd) + 1,
      left: lo * dayW,
      width: (hi - lo + 1) * dayW,
      aptId: selection.apartmentId,
      aptIdx,
    };
  }, [selection, days, dayW, apartments]);
}
