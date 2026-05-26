// =============================================================================
// 📋 frontend/src/components/calendar/CalendarSidebar.tsx
// =============================================================================
//
// Leva kolona sa listom apartmana.
// Namerno minimalna — samo prikazuje listu, bez logike.
// =============================================================================

import type { Apartment } from '../../../../shared/index';

interface CalendarSidebarProps {
  apartments: Apartment[];
}

export function CalendarSidebar({ apartments }: CalendarSidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">Apartman</div>
      {apartments?.map((a) => (
        <div key={a.id} className="sidebar-row">
          {a.name}
        </div>
      ))}
    </div>
  );
}
