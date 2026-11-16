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
        <span>Apartman</span> ||
        <span>Kapacitet</span>
      </div>

      {apartments?.map((a) => {
        // 1. Kastujemo apartman u legalni nepoznati Record objekat
        const rates = a.rates || [];

        // 2. ⚡ NAJBRŽA MOGUĆA VARIJANTA: Klasična 'for' petlja (O(N) složenost, 0% memorijskog naduta)
        let maxCapacity = 0;
        let minCapacity = 0; // Ako je potrebno, možemo pratiti i minimum

        for (let i = 0; i < rates.length; i++) {
          const currentCap = Number(rates[i].capacity || 0);
          if (currentCap > maxCapacity) {
            maxCapacity = currentCap;
          }
          if (currentCap < minCapacity || minCapacity === 0) {
            minCapacity = currentCap;
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
            {maxCapacity > 0 && minCapacity > 0 && (
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
                {minCapacity} - {maxCapacity} 👤
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
