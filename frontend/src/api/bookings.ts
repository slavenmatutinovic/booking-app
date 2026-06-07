// frontend/src/api/bookings.ts
//  CRUD za rezervacije
import apiFetch from './index';
import { remoteLogger } from '../utils/remoteLogger';
import {
  ReservationRequest,
  ApiBooking,
  CreateBookingPayload,
  UpdateBookingPayload,
  BookingsResponse,
} from '../../../shared/index';

// ─── GET /api/bookings ─────────────────────────────────────────────────────────
export const getBookings = async (params?: {
  month?: string;
  startMonth?: string;
  endMonth?: string;
  apartmentId?: string;
  cursor?: string;
  limit?: number;
}): Promise<BookingsResponse> => {
  const query = new URLSearchParams();
  if (params?.month) query.set('month', params.month);
  if (params?.startMonth) query.set('startMonth', params.startMonth);
  if (params?.endMonth) query.set('endMonth', params.endMonth);
  if (params?.apartmentId) query.set('apartmentId', params.apartmentId);
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.limit) query.set('limit', String(params.limit));

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

  remoteLogger({ level: 'info', message: `Učitano rezervacija: ${data.bookings?.length || 0}` });

  return {
    bookings: data.bookings || [],
    nextCursor: data.nextCursor || null,
  };
};

// ─── POST /api/bookings ────────────────────────────────────────────────────────
export const createBooking = async (payload: CreateBookingPayload): Promise<ApiBooking> => {
  remoteLogger({
    level: 'info',
    message: 'POST /api/bookings',
    errorDetails: { apartmentId: payload.apartmentId, guest: payload.guest },
  });

  const response = await apiFetch('bookings', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      startDate:
        typeof payload.startDate === 'string'
          ? payload.startDate
          : new Date(payload.startDate).toISOString(),
      endDate:
        typeof payload.endDate === 'string'
          ? payload.endDate
          : new Date(payload.endDate).toISOString(),
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
      startDate:
        typeof payload.startDate === 'string'
          ? payload.startDate
          : new Date(payload.startDate).toISOString(),
      endDate:
        typeof payload.endDate === 'string'
          ? payload.endDate
          : new Date(payload.endDate).toISOString(),
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

function toISOStringSafe(val: Date | string | undefined | null): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  // Fallback: forced string conversion catches any edge case
  return String(val);
}

export const updateBooking = async (
  id: string,
  payload: UpdateBookingPayload,
): Promise<ApiBooking> => {
  // Build a clean body — no Date objects can leak through spread
  const cleanBody: Record<string, unknown> = {};
  if (payload.guest !== undefined) cleanBody.guest = payload.guest;
  if (payload.email !== undefined) cleanBody.email = payload.email;
  if (payload.phone !== undefined) cleanBody.phone = payload.phone;
  if (payload.status !== undefined) cleanBody.status = payload.status;
  if (payload.startDate !== undefined) cleanBody.startDate = toISOStringSafe(payload.startDate);
  if (payload.endDate !== undefined) cleanBody.endDate = toISOStringSafe(payload.endDate);

  const response = await apiFetch(`bookings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(cleanBody),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Greška pri ažuriranju rezervacije');

  remoteLogger({ level: 'info', message: `Rezervacija ${id} ažurirana` });
  return data.booking;
};

// ─── GET /api/bookings/requests/pending (Admin uvid) ──────────────────────────
export const getPendingRequests = async (): Promise<ReservationRequest[]> => {
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
// ─── GET /api/bookings/requests/count (Badge za navigaciju) ───────────────────
export const getPendingRequestsCount = async (): Promise<number> => {
  const response = await apiFetch('bookings/requests/count');
  if (!response.ok) return 0; // Tiho ne prikazuje badge ako API zakaže
  const data = await response.json();
  return data.count ?? 0;
};

// ─── POST /api/bookings/requests/approve (Pametno odobravanje) ────────────────
export const approveBookingRequest = async (
  requestId: string,
): Promise<{ message: string; booking: ApiBooking }> => {
  remoteLogger({
    level: 'info',
    message: `POST /api/bookings/requests/approve — Odobravanje zahteva ${requestId}`,
  });

  const response = await apiFetch('bookings/requests/approve', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });

  const data = await response.json();

  if (!response.ok) {
    remoteLogger({ level: 'error', message: 'Greška pri odobravanju zahteva', errorDetails: data });
    throw new Error(data.error || 'Greška pri odobravanju zahteva.');
  }

  return data; // { message: string, booking: ApiBooking }
};

export const rejectBookingRequest = async (requestId: string): Promise<{ message: string }> => {
  remoteLogger({
    level: 'info',
    message: `PATCH /api/bookings/requests/${requestId}/reject — Odbijanje zahteva`,
  });

  const response = await apiFetch(`bookings/requests/${requestId}/reject`, {
    method: 'PATCH',
  });

  const data = await response.json();

  if (!response.ok) {
    remoteLogger({ level: 'error', message: 'Greška pri odbijanju zahteva', errorDetails: data });
    throw new Error(data.error || 'Greška pri odbijanju zahteva.');
  }

  return data;
};
