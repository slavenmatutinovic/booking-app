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
}

/**
 * 🧮 CLIENT-SIDE PRICING CALCULATION ENGINE
 * Evaluates overlapping seasonal fee grids day-by-day directly in browser RAM.
 */
export function calculateClientDynamicPrice(
  startDateStr: string | Date,
  endDateStr: string | Date,
  activeRatesList: ApartmentRateData[],
  defaultFallbackPrice = 50.0,
): ClientPriceCalculationResult {
  const startJsDate = new Date(startDateStr);
  const endJsDate = new Date(endDateStr);

  const totalNights = differenceInDays(endJsDate, startJsDate);

  let totalAccumulatedPrice = 0;
  const breakdown: DayBreakdownItem[] = [];
  let trackingDay = new Date(startJsDate);

  // Loop day-by-day through every single night of the selected interval
  for (let i = 0; i < totalNights; i++) {
    const formattedIsoKey = trackingDay.toISOString().split('T')[0];

    // Check if the current tracking day falls inside a specific custom season configuration
    const matchingSeasonalRate = activeRatesList.find((rate) => {
      const rateStart = new Date(rate.startDate);
      const rateEnd = new Date(rate.endDate);
      return trackingDay >= rateStart && trackingDay <= rateEnd;
    });

    // Use the custom seasonal rate if found; otherwise, fall back to the default property fee
    const applicableNightlyPrice = matchingSeasonalRate
      ? Number(matchingSeasonalRate.price)
      : defaultFallbackPrice;

    totalAccumulatedPrice += applicableNightlyPrice;
    breakdown.push({
      dateStr: formattedIsoKey,
      price: applicableNightlyPrice,
    });

    // Step forward by exactly one calendar day frame
    trackingDay = addDays(trackingDay, 1);
  }

  return {
    totalPrice: totalAccumulatedPrice,
    totalNights: totalNights > 0 ? totalNights : 0,
    averagePricePerNight: totalNights > 0 ? totalAccumulatedPrice / totalNights : 0,
    breakdown,
  };
}
