// frontend/src/utils/priceEngine.ts
import { addDays, differenceInDays } from 'date-fns';
import { ApartmentRateData } from '../../../shared/index';

export interface DayBreakdownItem {
  dateStr: string;
  price: number;
}

export interface ClientPriceCalculationResult {
  totalPrice: number;
  totalNights: number;
  averagePricePerNight: number;
  breakdown: DayBreakdownItem[];
  /** 🆕 Flag to alert the UI if any night of the stay lacks a configured rate */
  hasUnconfiguredDays: boolean;
}

/**
 * 🧮 CLIENT-SIDE PRICING CALCULATION ENGINE
 * Evaluates overlapping seasonal fee grids day-by-day directly in browser RAM.
 */
export function calculateClientDynamicPrice(
  startDateStr: string | Date,
  endDateStr: string | Date,
  activeRatesList: ApartmentRateData[],
): ClientPriceCalculationResult {
  const startJsDate = new Date(startDateStr);
  const endJsDate = new Date(endDateStr);

  const totalNights = differenceInDays(endJsDate, startJsDate);

  let totalAccumulatedPrice = 0;
  let hasUnconfiguredDays = false;
  const breakdown: DayBreakdownItem[] = [];
  let trackingDay = new Date(startJsDate);

  for (let i = 0; i < totalNights; i++) {
    const formattedIsoKey = trackingDay.toISOString().split('T')[0];

    // Find the explicit seasonal block wrapping this specific calendar night
    const matchingSeasonalRate = activeRatesList.find((rate) => {
      const rateStart = new Date(rate.startDate);
      const rateEnd = new Date(rate.endDate);
      return trackingDay >= rateStart && trackingDay <= rateEnd;
    });

    // 🛡️ NO FALLBACK PROTECTION: If unconfigured, the day costs 0 and sets the warning flag
    let applicableNightlyPrice = 0;
    if (matchingSeasonalRate) {
      applicableNightlyPrice = Number(matchingSeasonalRate.price);
    } else {
      hasUnconfiguredDays = true;
    }

    totalAccumulatedPrice += applicableNightlyPrice;
    breakdown.push({
      dateStr: formattedIsoKey,
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
