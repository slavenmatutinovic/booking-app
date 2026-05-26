// frontend/src/api/apartments.ts
// NOVI FAJL — čitanje apartmana iz baze
import apiFetch from './index';
import { remoteLogger } from '../utils/remoteLogger';

import { Apartment } from '../../../shared';

export interface ApartmentsResponse {
  apartments: Apartment[];
}

export const getApartments = async (): Promise<Apartment[]> => {
  remoteLogger({ level: 'info', message: 'Učitavanje apartmana iz API-ja' });

  const response = await apiFetch('apartments');
  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri učitavanju apartmana',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri učitavanju apartmana');
  }
  const apartmentsCount = data?.length || 0;
  remoteLogger({ level: 'info', message: `Učitano apartmana: ${apartmentsCount}` });
  return data;
};
