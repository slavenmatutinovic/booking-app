// frontend/src/utils/pricingCalculator.ts
import { addDays, differenceInDays } from 'date-fns';
import { ApartmentRateData } from '../../../shared';

export interface DayBreakdownItem {
  dateStr: string;
  price: number;
}

export interface ClientPriceCalculationResult {
  totalPrice: number;
  totalNights: number;
  averagePricePerNight: number;
  breakdown: DayBreakdownItem[];
  hasUnconfiguredDays: boolean;
}

// Pomoćna funkcija: Bezbedno čupa YYYY-MM-DD deo iz datuma
function cleanDateToIsoString(input: Date | string): string {
  const dateObj = typeof input === 'string' ? new Date(input) : input;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 🧮 VIŠEDIMENZIONALNI KLIJENTSKI OBRAČUN CENA (Pametna otporna verzija)
 */
export function calculateClientDynamicPrice(
  startDateStr: string | Date,
  endDateStr: string | Date,
  activeRatesList: ApartmentRateData[],
  fallbackPrice = 0.0,
  capacity = 2,
): ClientPriceCalculationResult {
  const startJsDate = new Date(startDateStr);
  const endJsDate = new Date(endDateStr);

  const totalNights = differenceInDays(endJsDate, startJsDate);

  let totalAccumulatedPrice = 0;
  let hasUnconfiguredDays = false;
  const breakdown: DayBreakdownItem[] = [];

  let trackingDay = new Date(startJsDate);

  for (let i = 0; i < totalNights; i++) {
    const trackingDayStr = cleanDateToIsoString(trackingDay);

    const matchingSeasonalRate = activeRatesList.find((rate: ApartmentRateData) => {
      const rateStartStr = cleanDateToIsoString(rate.startDate);
      const rateEndStr = cleanDateToIsoString(rate.endDate);

      const isDateInsideRange = trackingDayStr >= rateStartStr && trackingDayStr <= rateEndStr;

      // 🛡️ PAMETNI FALLBACK: Ako baza još uvek ne šalje polje capacity,
      // čitamo poslednji broj iz id-a (npr. "r2_1_1" završava sa 1 za 2 kreveta, "r2_1_2" sa 2 za 3 kreveta, itd.)
      let dbCapacity = 2;

      const extendedRate = rate as ApartmentRateData & { capacity?: unknown; id?: string };

      if (extendedRate.capacity !== undefined && extendedRate.capacity !== null) {
        dbCapacity = Number(extendedRate.capacity);
      } else if (typeof extendedRate.id === 'string') {
        const parts = extendedRate.id.split('_');
        const lastNum = parseInt(parts[parts.length - 1] || '1', 10);

        if (lastNum === 1) dbCapacity = 2;
        if (lastNum === 2) dbCapacity = 3;
        if (lastNum === 3) dbCapacity = 4;
        if (lastNum === 4) dbCapacity = 5;
      }

      const isCapacityMatching = Number(dbCapacity) === Number(capacity);

      return isDateInsideRange && isCapacityMatching;
    });

    let applicableNightlyPrice = fallbackPrice;
    if (matchingSeasonalRate) {
      applicableNightlyPrice = Number(matchingSeasonalRate.price);
    } else {
      hasUnconfiguredDays = true;
    }

    totalAccumulatedPrice += applicableNightlyPrice;

    breakdown.push({
      dateStr: trackingDayStr,
      price: applicableNightlyPrice,
    });

    trackingDay = addDays(trackingDay, 1);
  }

  return {
    totalPrice: totalAccumulatedPrice,
    totalNights: totalNights > 0 ? totalNights : 0,
    averagePricePerNight: totalNights > 0 ? totalAccumulatedPrice / totalNights : 0,
    breakdown,
    hasUnconfiguredDays,
  };
}
