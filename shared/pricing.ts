import { ApartmentRateData, parseUTCDate } from './index';

export interface CalculatePriceArgs {
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
    const currentNightTime = Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + i,
      0,
      0,
      0,
      0,
    );
    const currentNight = new Date(currentNightTime);

    const matchingRate = rates.find((r) => {
      const rateStart = new Date(r.startDate);
      const rateEnd = new Date(r.endDate);

      // Normalizacija: Početak sezone u 00:00:00 trenutne vremenske zone datuma
      const startTimestamp = Date.UTC(
        rateStart.getUTCFullYear(),
        rateStart.getUTCMonth(),
        rateStart.getUTCDate(),
      );

      // Normalizacija: Kraj sezone pomeramo na 00:00:00 sledećeg dana (ekskluzivna gornja granica sezone)
      // Ovo garantuje da je celi poslednji dan obuhvaćen bez matematičkog preklapanja sa narednom sezonom
      const endTimestamp = Date.UTC(
        rateEnd.getUTCFullYear(),
        rateEnd.getUTCMonth(),
        rateEnd.getUTCDate() + 1,
      );

      return (
        currentNightTime >= startTimestamp &&
        currentNightTime < endTimestamp &&
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
