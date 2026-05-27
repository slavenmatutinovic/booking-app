// frontend/src/api/bookings.ts
// NOVI FAJL — CRUD za rezervacije
import apiFetch from './index';
import { remoteLogger } from '../utils/remoteLogger';
import { ApiReservationRequest } from '../types/ui';

// Tip koji koristi BookingCalendar.tsx interno
export interface BookingAPI {
  id: string;
  apartmentId: string;
  guest: string;
  email?: string | null;
  phone?: string | null;
  startDate: string; // ISO string iz baze — konvertujemo u 'yyyy-MM-dd' za kalendar
  endDate: string;
  status: 'CONFIRMED' | 'CANCELLED';
  apartment?: { id: string; name: string };
}

export interface CreateBookingPayload {
  apartmentId: string;
  guest: string;
  email: string;
  phone?: string | null;
  startDate: Date;
  endDate: Date;
}

// ─── GET /api/bookings ─────────────────────────────────────────────────────────
export const getBookings = async (params?: {
  month?: string;
  apartmentId?: string;
}): Promise<BookingAPI[]> => {
  const query = new URLSearchParams();
  if (params?.month) query.set('month', params.month);
  if (params?.apartmentId) query.set('apartmentId', params.apartmentId);

  const endpoint = `bookings${query.toString() ? '?' + query.toString() : ''}`;
  remoteLogger({ level: 'info', message: `GET /api/${endpoint}` });

  const response = await apiFetch(endpoint);
  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri učitavanju rezervacija',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri učitavanju rezervacija');
  }

  remoteLogger({ level: 'info', message: `Učitano rezervacija: ${data.bookings.length}` });
  return data.bookings;
};

// ─── POST /api/bookings ────────────────────────────────────────────────────────
export const createBooking = async (payload: CreateBookingPayload): Promise<BookingAPI> => {
  remoteLogger({
    level: 'info',
    message: 'POST /api/bookings',
    errorDetails: { apartmentId: payload.apartmentId, guest: payload.guest },
  });

  const response = await apiFetch('bookings', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      // Konvertujemo Date u ISO string (JSON.stringify ne radi to automatski za Date)
      startDate: payload.startDate.toISOString(),
      endDate: payload.endDate.toISOString(),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 409) {
      remoteLogger({ level: 'warn', message: 'Konflikt termina', errorDetails: data });
      throw new Error(`Termin zauzet: ${data.error}`);
    }
    remoteLogger({
      level: 'error',
      message: 'Greška pri kreiranju rezervacije',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri kreiranju rezervacije');
  }

  remoteLogger({
    level: 'info',
    message: 'Rezervacija kreirana',
    errorDetails: { bookingId: data.booking.id },
  });
  return data.booking;
};

// ─── POST /api/bookings/requests (Zahtev gosta na čekanju) ──────────────────────
export const createBookingRequest = async (
  payload: CreateBookingPayload,
): Promise<{ message: string }> => {
  // Bezbedno logovanje pomoću optional chaining-a (?.) da sprečimo pad frontenda
  remoteLogger({
    level: 'info',
    message: 'Klijentski zahtev: POST /api/bookings/requests',
    errorDetails: {
      apartmentId: payload?.apartmentId,
      guest: payload?.guest,
    },
  });

  // 🚀 POGAĐA TAČNU NOVU PUTANJU: /api/bookings/requests
  const response = await apiFetch('bookings/requests', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      startDate: payload?.startDate?.toISOString(),
      endDate: payload?.endDate?.toISOString(),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri slanju zahteva gosta',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri slanju zahteva');
  }

  remoteLogger({
    level: 'info',
    message: 'Zahtev gosta uspešno prosleđen',
    errorDetails: data,
  });

  return data;
};

// ─── DELETE /api/bookings/:id (soft delete) ────────────────────────────────────
export const deleteBooking = async (id: string): Promise<void> => {
  remoteLogger({ level: 'info', message: `DELETE /api/bookings/${id}` });

  const response = await apiFetch(`bookings/${id}`, { method: 'DELETE' });
  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri brisanju rezervacije',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri brisanju rezervacije');
  }

  remoteLogger({ level: 'info', message: `Rezervacija ${id} otkazana` });
};
// ─── UPDATE /api/bookings/:id  ────────────────────────────────────
export const updateBooking = async (
  id: string,
  payload: Partial<CreateBookingPayload> & { status?: 'CONFIRMED' | 'CANCELLED' },
): Promise<BookingAPI> => {
  const response = await apiFetch(`bookings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...payload,
      startDate: payload.startDate?.toISOString(),
      endDate: payload.endDate?.toISOString(),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Greška pri ažuriranju rezervacije');

  remoteLogger({ level: 'info', message: `Rezervacija ${id} ažurirana` });
  return data.booking;
};

// ─── GET /api/bookings/requests/pending (Admin uvid) ──────────────────────────
export const getPendingRequests = async (): Promise<ApiReservationRequest[]> => {
  remoteLogger({
    level: 'info',
    message: 'GET /api/bookings/requests/pending — Povlačenje zahteva',
  });

  const response = await apiFetch('bookings/requests/pending');
  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri čitanju zahteva na čekanju',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri čitanju zahteva.');
  }

  return data;
};

// ─── POST /api/bookings/requests/approve (Pametno odobravanje) ────────────────
export const approveBookingRequest = async (requestId: string): Promise<ApiReservationRequest> => {
  remoteLogger({
    level: 'info',
    message: `POST /api/bookings/requests/approve — Odobravanje zahteva ${requestId}`,
  });

  // 🚀 ŠALJEMO REQUEST_ID U BODY-JU: Aktivira naš pametni kontroler na beku
  const response = await apiFetch('bookings/requests/approve', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });

  const data = await response.json();

  if (!response.ok) {
    remoteLogger({
      level: 'error',
      message: 'Greška pri odobravanju zahteva',
      errorDetails: data,
    });
    throw new Error(data.error || 'Greška pri odobravanju zahteva.');
  }

  return data;
};
