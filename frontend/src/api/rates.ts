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

export const deleteApartmentRate = async (id: string): Promise<{ message: string }> => {
  const response = await apiFetch(`apartments/rates/${id}`, {
    method: 'DELETE',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Neuspešno brisanje sezonske cene.');
  }
  return data;
};

export interface UpdateRateServerResponse {
  message: string;
  rate: ApartmentRateData;
}

/**
 * Šalje zahtev za izmenu cene postojećeg sezonskog bloka bez upotrebe 'any' tipa.
 */
export const updateApartmentRate = async (
  id: string,
  price: number,
): Promise<UpdateRateServerResponse> => {
  const response = await apiFetch(`apartments/rates/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ price }),
  });

  const data = (await response.json()) as UpdateRateServerResponse & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || 'Neuspešna izmena sezonske cene.');
  }

  return {
    message: data.message,
    rate: data.rate,
  };
};

/**
 * Povlači sve sezonske cene za jedan specifičan apartman na osnovu njegovog ID-ja.
 */

interface ServerErrorResponse {
  error?: string;
}

export interface GetRatesServerResponse {
  rates: ApartmentRateData[];
}

export const getApartmentRates = async (apartmentId: string): Promise<GetRatesServerResponse> => {
  const response = await apiFetch(`apartments/${apartmentId}/rates`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = (await response.json()) as ServerErrorResponse;
    throw new Error(errorData.error || 'Neuspešno učitavanje sezonskih cena.');
  }

  return (await response.json()) as GetRatesServerResponse;
};
