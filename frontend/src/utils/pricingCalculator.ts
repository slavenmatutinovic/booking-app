// frontend/src/utils/pricingCalculator.ts
import { addDays, differenceInDays } from 'date-fns';
import { ApartmentRateData } from '../../../shared';
import { parseDateStr, cleanDateToIsoString } from './dates';

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

      const dbCapacity =
        rate.capacity !== undefined && rate.capacity !== null ? Number(rate.capacity) : 2; // Razumni podrazumevani default (2 osobe)

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
