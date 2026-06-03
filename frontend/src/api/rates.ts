import apiFetch from './index';
import { ApartmentRateData } from '../../../shared/index';

export interface CreateRatePayload {
  apartmentId: string;
  startDate: string; // ISO String "YYYY-MM-DD"
  endDate: string; // ISO String "YYYY-MM-DD"
  price: number;
}

/**
 * Sends a structured seasonal pricing block directly to the backend matrix.
 */
export const createApartmentRate = async (
  payload: CreateRatePayload,
): Promise<{ message: string; rate: ApartmentRateData }> => {
  const response = await apiFetch('apartments/rates', {
    method: 'POST',
    body: JSON.stringify({
      apartmentId: payload.apartmentId,
      // Convert standard form calendar picks to fully compliant ISO structures
      startDate: new Date(payload.startDate).toISOString(),
      endDate: new Date(payload.endDate).toISOString(),
      price: Number(payload.price),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Neuspešno kreiranje sezonske cene.');
  }

  return data;
};
