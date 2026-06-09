import type { Apartment } from '../../../../shared/index';

interface CalendarSidebarProps {
  apartments: Apartment[];
}

export function CalendarSidebar({ apartments }: CalendarSidebarProps) {
  return (
    <div className="sidebar">
      <div
        className="sidebar-header"
        style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '10px' }}
      >
        <span>Apartman</span>
        <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 'normal' }}>
          Maks. Kapacitet
        </span>
      </div>

      {apartments?.map((a) => {
        // 1. Kastujemo apartman u legalni nepoznati Record objekat
        const rawApt = a as unknown as Record<string, unknown>;
        const rates = Array.isArray(rawApt.rates) ? rawApt.rates : [];

        // 2. ⚡ NAJBRŽA MOGUĆA VARIJANTA: Klasična 'for' petlja (O(N) složenost, 0% memorijskog naduta)
        let maxCapacity = 0;

        for (let i = 0; i < rates.length; i++) {
          const rateObj = rates[i] as Record<string, unknown>;
          const currentCap = Number(rateObj.capacity || 0);
          if (currentCap > maxCapacity) {
            maxCapacity = currentCap; // Ako nađemo veći kapacitet (npr. 5), upisujemo ga
          }
        }

        return (
          <div
            key={a.id}
            className="sidebar-row"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingRight: '10px',
            }}
          >
            <span>{a.name}</span>

            {/* 👤 Bedž koji garantovano prikazuje tačan maksimum (npr. 5 👤) */}
            {maxCapacity > 0 && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#4b5563',
                  backgroundColor: '#f3f4f6',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                {maxCapacity} 👤
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
