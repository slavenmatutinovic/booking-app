// =============================================================================
// 🪝 frontend/src/hooks/useCalendarLayout.ts
// =============================================================================
//
// Prati širinu timeline kontejnera pomoću ResizeObserver-a i
// izračunava broj dana (numDays) i širinu ćelije (dayW).
//
// Izdvojen iz useCalendar/BookingCalendar jer je ovo čisto UI/layout logika
// bez veze sa domenskim podacima.
// =============================================================================

import { useState, useEffect, useRef, useMemo } from 'react';

interface CalendarLayoutResult {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  containerWidth: number;
  numDays: number;
  dayW: number;
}

export function useCalendarLayout(minDayW: number): CalendarLayoutResult {
  const timelineRef    = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      setContainerWidth(entries[0].contentRect.width);
    });

    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const numDays = useMemo(() => {
    if (containerWidth <= 0) return 30;
    return Math.max(1, Math.floor(containerWidth / minDayW));
  }, [containerWidth, minDayW]);

  const dayW = useMemo(() => {
    if (containerWidth <= 0 || numDays <= 0) return minDayW;
    return containerWidth / numDays;
  }, [containerWidth, numDays, minDayW]);

  return { timelineRef, containerWidth, numDays, dayW };
}
