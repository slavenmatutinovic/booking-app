// frontend/src/api/apartments.ts
// NOVI FAJL — čitanje apartmana iz baze
import apiFetch from './index';
import { remoteLogger } from '../utils/remoteLogger';

import { Apartment } from '../../../shared';

export interface ApartmentsResponse {
  apartments: Apartment[];
}
export interface ApiErrorResponse {
  error: string;
}

export const getApartments = async (): Promise<Apartment[]> => {
  remoteLogger({ level: 'info', message: 'Učitavanje apartmana iz API-ja' });

  const response = await apiFetch('apartments');
  const data: ApartmentsResponse | ApiErrorResponse = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri učitavanju apartmana',
      errorDetails: data,
    });
    const errorMessage = 'error' in data ? data.error : 'Greška pri učitavanju apartmana';
    throw new Error(errorMessage);
  }
  const apartmentsList = (data as ApartmentsResponse).apartments || [];
  const apartmentsCount = apartmentsList.length;
  remoteLogger({ level: 'info', message: `Učitano apartmana: ${apartmentsCount}` });
  return apartmentsList;
};
