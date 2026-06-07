// frontend/src/utils/pricingCalculator.ts
import { addDays, differenceInDays } from 'date-fns';
import { ApartmentRateData } from '../../../shared';
import { parseDateStr } from './dates';

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
  if (typeof input === 'string') {
    // Ako je već ISO string ili sadrži vremensku zonu, izolujemo samo YYYY-MM-DD deo
    const cleanStr = input.split('T')[0] ?? '';
    // Ako string odgovara YYYY-MM-DD formatu, vraćamo ga direktno bez parsiranja
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
      return cleanStr;
    }
    const parsed = parseDateStr(cleanStr);
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
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
  const startJsDate =
    typeof startDateStr === 'string'
      ? parseDateStr(startDateStr.split('T')[0] ?? '')
      : startDateStr;

  const endJsDate =
    typeof endDateStr === 'string' ? parseDateStr(endDateStr.split('T')[0] ?? '') : endDateStr;

  const totalNights = differenceInDays(endJsDate, startJsDate);

  let totalAccumulatedPrice = 0;
  let hasUnconfiguredDays = false;
  const breakdown: DayBreakdownItem[] = [];

  let trackingDay = new Date(startJsDate.getTime());

  for (let i = 0; i < totalNights; i++) {
    const trackingDayStr = cleanDateToIsoString(trackingDay);

    const matchingSeasonalRate = activeRatesList.find((rate: ApartmentRateData) => {
      const rateStartStr = cleanDateToIsoString(rate.startDate);
      const rateEndStr = cleanDateToIsoString(rate.endDate);

      const isDateInsideRange = trackingDayStr >= rateStartStr && trackingDayStr <= rateEndStr;

      let dbCapacity = 2;

      const extendedRate = rate as ApartmentRateData & Record<string, unknown>;

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
