import { prisma } from '../../../backend/src/config/prisma';
import { differenceInDays, addDays } from 'date-fns';

interface CalculatedInvoiceDetails {
  totalPrice: number;
  averagePricePerNight: number;
  breakdown: Array<{ date: string; price: number }>;
}

/**
 * 🧮 DYNAMIC PRICING ENGINE
 * Day-by-day lookup mapping that calculates itemized costs across overlapping months.
 */
export const calculateDynamicPrice = async (
  apartmentId: string,
  startDate: Date,
  endDate: Date,
): Promise<CalculatedInvoiceDetails> => {
  // 1. Pull all active seasonal configuration rows for this property
  const activeRates = await prisma.apartmentRate.findMany({
    where: { apartmentId },
    orderBy: { startDate: 'asc' },
  });

  let totalPrice = 0;
  const breakdown: Array<{ date: string; price: number }> = [];

  // Total nights is calculated by counting overnight intervals
  const totalNights = differenceInDays(endDate, startDate);
  let currentDay = new Date(startDate);

  // 2. Loop over every night of the stay sequence
  for (let i = 0; i < totalNights; i++) {
    const formattedDate = currentDay.toISOString().split('T')[0];

    // Find if a specific seasonal rate block covers this specific day
    const matchingRate = activeRates.find(
      (rate) => currentDay >= rate.startDate && currentDay <= rate.endDate,
    );

    // Standard fallback fallback flat fee if the admin forgot to configure a season
    const nightlyPrice = matchingRate ? Number(matchingRate.price) : 50.0;

    totalPrice += nightlyPrice;
    breakdown.push({ date: formattedDate, price: nightlyPrice });

    // Step forward exactly 1 calendar day
    currentDay = addDays(currentDay, 1);
  }

  return {
    totalPrice,
    averagePricePerNight: totalNights > 0 ? totalPrice / totalNights : 0,
    breakdown,
  };
};
