import { ApartmentRateData, parseUTCDate } from './index';

interface CalculatePriceArgs {
  rates: ApartmentRateData[]; // Koristi se isključivo tvoj postojeći bazni interface
  startDateInput: string | Date;
  totalNights: number;
  bookingCapacity: number;
  returnBreakdown?: boolean;
}

/**
 * Jedinstveni algoritam za kalkulaciju cene smeštaja bez ikakvih dodatnih interface-a.
 */
export function calculateStayPriceShared({
  rates,
  startDateInput,
  totalNights,
  bookingCapacity,
  returnBreakdown = false,
}: CalculatePriceArgs):
  | number
  | {
      totalPrice: number;
      averagePricePerNight: number;
      breakdown: { dateStr: string; price: number }[];
    } {
  let totalPrice = 0;
  const breakdown: { dateStr: string; price: number }[] = [];
  const baseDate = parseUTCDate(startDateInput);

  for (let i = 0; i < totalNights; i++) {
    const currentNight = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    const currentNightTime = currentNight.getTime();

    const matchingRate = rates.find((r) => {
      const rateStart = parseUTCDate(r.startDate).getTime();
      const rateEnd = parseUTCDate(r.endDate).getTime();
      return (
        currentNightTime >= rateStart &&
        currentNightTime < rateEnd &&
        Number(r.capacity) === Number(bookingCapacity)
      );
    });

    const year = currentNight.getUTCFullYear();
    const month = String(currentNight.getUTCMonth() + 1).padStart(2, '0');
    const day = String(currentNight.getUTCDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    if (!matchingRate) {
      throw new Error(
        `PRICING_FAILED: Nedostaje cena za datum [${dateString}] i kapacitet [${bookingCapacity}].`,
      );
    }
    const priceForNight = Number(matchingRate.price);
    totalPrice += Number(matchingRate.price);

    if (returnBreakdown) {
      breakdown.push({
        dateStr: dateString,
        price: priceForNight,
      });
    }
  }

  // 🎯 USLOVNI POVRAT: Ako front traži breakdown, vraćamo puni objekat, inače samo broj za bazu
  if (returnBreakdown) {
    return {
      totalPrice,
      averagePricePerNight: totalNights > 0 ? totalPrice / totalNights : 0,
      breakdown,
    };
  }

  return totalPrice;
}
