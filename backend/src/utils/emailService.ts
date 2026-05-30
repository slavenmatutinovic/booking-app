/**
 * emailService.ts — Nodemailer servis za slanje notifikacija rezervacija.
 *
 * Podržane notifikacije:
 *   1. sendBookingConfirmation    — Potvrda rezervacije gostu + adminu
 *   2. sendBookingCancellation   — Otkazivanje rezervacije gostu + adminu
 *   3. sendBookingModification   — Izmena datuma rezervacije gostu       [NOVO]
 *   4. sendNewRequestToAdmin     — Admin: novi zahtev gosta na čekanju   [NOVO - BUG-01]
 *   5. sendRequestReceivedToGuest— Gost: potvrda prijema zahteva         [NOVO - BUG-01]
 *   6. sendRequestRejectedToGuest— Gost: obaveštenje o odbijanju         [NOVO - BUG-03]
 */

import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

// =============================================================================
// 📧 TIPOVI
// =============================================================================

export interface BookingEmailData {
  id: string;
  guest: string;
  email: string;
  phone?: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  apartment: {
    id: string;
    name: string;
  };
}

/** Podaci o zahtevu za rezervaciju (ReservationRequest) */
export interface RequestEmailData {
  id: string;
  guest: string;
  email: string;
  phone?: string | null;
  startDate: Date;
  endDate: Date;
  apartment: {
    id: string;
    name: string;
  };
}

/**
 * Centralized HTML Entity Escaper
 * Converts high-risk control markup characters into literal text strings
 */
const escapeHtml = (unsafeString: unknown): string => {
  if (unsafeString === null || unsafeString === undefined) return '';

  return String(unsafeString)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// =============================================================================
// 🔌 INICIJALIZACIJA TRANSPORTA
// =============================================================================

function createTransporter(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    logger.warn(
      '⚠️ SMTP nije konfigurisan (SMTP_HOST/SMTP_USER/SMTP_PASS nedostaju) — emailovi se neće slati.',
    );
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    connectionTimeout: 5000,
    greetingTimeout: 3000,
  });

  return transporter;
}

const transporter = createTransporter();

// =============================================================================
// 🧮 HELPER FUNKCIJE
// =============================================================================

function formatDateSr(date: Date): string {
  return date.toLocaleDateString('sr-RS', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function calcNights(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

// =============================================================================
// 🎨 EMAIL TEMPLATE-I
// =============================================================================

function buildConfirmationEmailHtml(data: BookingEmailData): string {
  const nights = calcNights(data.startDate, data.endDate);
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potvrda rezervacije</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#4f46e5; padding: 32px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
                ✅ Rezervacija Potvrđena
              </h1>
              <p style="margin:8px 0 0; color:#c7d2fe; font-size:14px;">
                Booking ID: <strong>${data.id}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${escapeHtml(data.guest)}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Vaša rezervacija je uspešno potvrđena. U nastavku se nalaze detalji:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f9fafb; border-radius:6px; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px; width:40%;">🏠 Apartman:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${data.apartment.name}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(startStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(endStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">🌙 Broj noći:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${nights}</td>
                      </tr>
                      ${
                        data.phone
                          ? `<tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📞 Telefon:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(data.phone)}</td>
                      </tr>`
                          : ''
                      }
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px; color:#374151; font-size:14px; line-height:1.6;">
                Ako imate pitanja ili trebate da izmenite rezervaciju, kontaktirajte nas odgovorom na ovaj email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Ova poruka je automatski generisana — molimo ne odgovarajte direktno.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildCancellationEmailHtml(data: BookingEmailData): string {
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Otkazivanje rezervacije</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#dc2626; padding: 32px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
                ❌ Rezervacija Otkazana
              </h1>
              <p style="margin:8px 0 0; color:#fca5a5; font-size:14px;">
                Booking ID: <strong>${data.id}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${escapeHtml(data.guest)}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Vaša rezervacija je otkazana. Detalji:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#fef2f2; border-radius:6px; margin-bottom:24px; border: 1px solid #fecaca;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px; width:40%;">🏠 Apartman:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(data.apartment.name)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(startStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(endStr)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px; color:#374151; font-size:14px; line-height:1.6;">
                Ako smatrate da je ovo greška ili imate pitanja, kontaktirajte nas odgovorom na ovaj email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Ova poruka je automatski generisana — molimo ne odgovarajte direktno.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// [NOVO] HTML template za obaveštenje gostu da je zahtev primljen (BUG-01)
function buildRequestReceivedHtml(data: RequestEmailData): string {
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);
  const nights = calcNights(data.startDate, data.endDate);

  return `
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zahtev za rezervaciju primljen</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#0891b2; padding: 32px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
                📬 Zahtev Primljen
              </h1>
              <p style="margin:8px 0 0; color:#a5f3fc; font-size:14px;">
                Vaš zahtev je prosleđen na odobrenje
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 16px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${escapeHtml(data.guest)}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Vaš zahtev za rezervaciju je uspešno primljen i prosleđen adminu na odobrenje. Obaveštićemo vas čim bude obrađen.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#ecfeff; border-radius:6px; margin-bottom:24px; border: 1px solid #a5f3fc;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px; width:40%;">🏠 Apartman:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(data.apartment.name)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(startStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(endStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">🌙 Broj noći:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(nights)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px; color:#374151; font-size:14px; line-height:1.6; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:12px 16px;">
                ⏳ <strong>Napomena:</strong> Zahtevi se obrađuju u roku od 24 sata. Ako u tom periodu ne dobijete odgovor, zahtev automatski ističe.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Ova poruka je automatski generisana — molimo ne odgovarajte direktno.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// [NOVO] HTML template za obaveštenje gostu da je zahtev odbijen (BUG-03)
function buildRequestRejectedHtml(data: RequestEmailData): string {
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zahtev za rezervaciju odbijen</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#9333ea; padding: 32px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
                ℹ️ Zahtev Nije Odobren
              </h1>
              <p style="margin:8px 0 0; color:#e9d5ff; font-size:14px;">
                Nažalost, vaš zahtev nije mogao biti odobren
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 16px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${escapeHtml(data.guest)}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Nažalost, vaš zahtev za rezervaciju nije odobren. Razlog može biti zauzet termin ili drugi tehnički razlozi.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#faf5ff; border-radius:6px; margin-bottom:24px; border: 1px solid #e9d5ff;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px; width:40%;">🏠 Apartman:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(data.apartment.name)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(startStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(endStr)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px; color:#374151; font-size:14px; line-height:1.6;">
                Možete pokušati sa drugim terminom ili kontaktirati nas direktno za više informacija.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Ova poruka je automatski generisana — molimo ne odgovarajte direktno.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// [NOVO] HTML template za obaveštenje o izmeni rezervacije (BUG-10)
function buildModificationEmailHtml(data: BookingEmailData): string {
  const nights = calcNights(data.startDate, data.endDate);
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Izmena rezervacije</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#0f766e; padding: 32px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
                ✏️ Rezervacija Izmenjena
              </h1>
              <p style="margin:8px 0 0; color:#99f6e4; font-size:14px;">
                Booking ID: <strong>${data.id}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${escapeHtml(data.guest)}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Vaša rezervacija je izmenjena. Novi detalji:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f0fdfa; border-radius:6px; margin-bottom:24px; border: 1px solid #99f6e4;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px; width:40%;">🏠 Apartman:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(data.apartment.name)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Novi dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(startStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Novi odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(endStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">🌙 Broj noći:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${escapeHtml(nights)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Ova poruka je automatski generisana — molimo ne odgovarajte direktno.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Tekst email za admina o rezervaciji — kompaktan, samo bitne informacije.
 */
function buildAdminNotificationText(
  data: BookingEmailData,
  eventType: 'NOVA' | 'OTKAZANA' | 'IZMENJENA',
): string {
  const nights = calcNights(data.startDate, data.endDate);
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
[${eventType} REZERVACIJA] ID: ${data.id}

Apartman  : ${escapeHtml(data.apartment.name)}
Gost      : ${escapeHtml(data.guest)}
Email     : ${escapeHtml(data.email)}
Telefon   : ${escapeHtml(data.phone || 'Nije uneto')}
Dolazak   : ${escapeHtml(startStr)}
Odlazak   : ${escapeHtml(endStr)}
Noći      : ${escapeHtml(nights)}
Status    : ${escapeHtml(data.status)}
  `.trim();
}

/**
 * [NOVO] Tekst email za admina o novom zahtevu gosta (BUG-01)
 */
function buildAdminNewRequestText(data: RequestEmailData): string {
  const nights = calcNights(data.startDate, data.endDate);
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
[NOVI ZAHTEV] Čeka vaše odobrenje

Apartman  : ${escapeHtml(data.apartment.name)}
Gost      : ${escapeHtml(data.guest)}
Email     : ${escapeHtml(data.email)}
Telefon   : ${escapeHtml(data.phone || 'Nije uneto')}
Dolazak   : ${escapeHtml(startStr)}
Odlazak   : ${escapeHtml(endStr)}
Noći      : ${escapeHtml(nights)}

Prijavite se i idite na /admin/requests da odobrite ili odbijete zahtev.
  `.trim();
}

// =============================================================================
// CENTRALNI RETRY OMOTAČ 🛡️ — POBOLJŠANJE-07
// =============================================================================

interface MailPayload {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text: string;
}

/**
 * Pomoćna funkcija koja sliku slanja email-a umotava u eksponencijalni retry algoritam.
 * Ako slanje ne uspe, pokušaće ponovo do 3 puta sa progresivno dužim pauzama (1s -> 2s -> 4s).
 */
async function sendMailWithRetry(mailOptions: MailPayload, attempt = 1): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1000; // Početno čekanje od 1 sekunde

  if (!transporter) {
    logger.warn({ to: mailOptions.to }, '⚠ Slanje otkazano — SMTP nije konfigurisan');
    return;
  }

  try {
    // Pokušavamo nativno slanje preko Nodemailer-a
    await transporter.sendMail(mailOptions);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'SMTP Timeout/Socket Error';

    if (attempt < MAX_ATTEMPTS) {
      // Računamo progresivni delay: Pokušaj 1 = 1s, Pokušaj 2 = 2s, Pokušaj 3 = 4s
      const nextDelay = BASE_DELAY_MS * Math.pow(2, attempt - 1);

      logger.warn(
        { attempt, nextDelayMs: nextDelay, target: mailOptions.to, errorMsg },
        `⚠️ [MAIL ENGINE] Slanje email-a neuspešno. Pokrećem ponovni pokušaj za ${nextDelay / 1000}s...`,
      );

      // Asinhrono pauziramo izvršavanje niti pre rekurzivnog pokušaja
      await new Promise((resolve) => setTimeout(resolve, nextDelay));

      // Pokrećemo sledeću faza slanja sa uvećanim indeksom pokušaja
      return sendMailWithRetry(mailOptions, attempt + 1);
    }

    // Ako smo ispucali sva 3 pokušaja, upisujemo kritičnu grešku u logove sistema
    logger.error(
      { attemptsExhausted: attempt, target: mailOptions.to, err },
      '❌ [MAIL ENGINE CRITICAL] Slanje email obaveštenja definitivno neuspešno nakon 3 uzastopna pokušaja!',
    );
    throw new Error(`Email dostava prekinuta nakon maksimalnog broja pokušaja: ${errorMsg}`);
  }
}

// =============================================================================
// 📤 JAVNE FUNKCIJE ZA SLANJE
// =============================================================================

export async function sendBookingConfirmation(data: BookingEmailData): Promise<void> {
  if (!transporter) {
    logger.warn({ bookingId: data.id }, '⚠️ Email potvrde nije poslat — SMTP nije konfigurisan');
    return;
  }

  const subject = `✅ Potvrda rezervacije — ${data.apartment.name} | ${formatDateSr(data.startDate)}`;

  const tasks: Promise<unknown>[] = [
    sendMailWithRetry({
      from: env.SMTP_FROM,
      to: data.email,
      subject,
      html: buildConfirmationEmailHtml(data),
      text: `Rezervacija potvrđena za ${data.apartment.name} od ${formatDateSr(data.startDate)} do ${formatDateSr(data.endDate)}.`,
    }),
  ];

  if (env.ADMIN_EMAIL) {
    tasks.push(
      sendMailWithRetry({
        from: env.SMTP_FROM,
        to: env.ADMIN_EMAIL,
        subject: `[NOVA] ${data.apartment.name} — ${data.guest} | ${formatDateSr(data.startDate)}`,
        text: buildAdminNotificationText(data, 'NOVA'),
      }),
    );
  }

  await Promise.all(tasks);

  logger.info(
    { bookingId: data.id, guestEmail: data.email, adminNotified: !!env.ADMIN_EMAIL },
    '✉️ Email potvrde rezervacije uspešno poslat',
  );
}

export async function sendBookingCancellation(data: BookingEmailData): Promise<void> {
  if (!transporter) {
    logger.warn(
      { bookingId: data.id },
      '⚠️ Email otkazivanja nije poslat — SMTP nije konfigurisan',
    );
    return;
  }

  const subject = `❌ Rezervacija otkazana — ${data.apartment.name} | ${formatDateSr(data.startDate)}`;

  const tasks: Promise<unknown>[] = [
    sendMailWithRetry({
      from: env.SMTP_FROM,
      to: data.email,
      subject,
      html: buildCancellationEmailHtml(data),
      text: `Vaša rezervacija za ${data.apartment.name} od ${formatDateSr(data.startDate)} do ${formatDateSr(data.endDate)} je otkazana.`,
    }),
  ];

  if (env.ADMIN_EMAIL) {
    tasks.push(
      sendMailWithRetry({
        from: env.SMTP_FROM,
        to: env.ADMIN_EMAIL,
        subject: `[OTKAZANA] ${data.apartment.name} — ${data.guest} | ${formatDateSr(data.startDate)}`,
        text: buildAdminNotificationText(data, 'OTKAZANA'),
      }),
    );
  }

  await Promise.all(tasks);

  logger.info(
    { bookingId: data.id, guestEmail: data.email },
    '✉️ Email otkazivanja rezervacije uspešno poslat',
  );
}

// [NOVO] Šalje email gostu kad su mu datumi promenjeni (BUG-10)
export async function sendBookingModification(data: BookingEmailData): Promise<void> {
  if (!transporter) {
    logger.warn({ bookingId: data.id }, '⚠️ Email izmene nije poslat — SMTP nije konfigurisan');
    return;
  }

  const subject = `✏️ Rezervacija izmenjena — ${data.apartment.name} | ${formatDateSr(data.startDate)}`;

  const tasks: Promise<unknown>[] = [
    sendMailWithRetry({
      from: env.SMTP_FROM,
      to: data.email,
      subject,
      html: buildModificationEmailHtml(data),
      text: `Vaša rezervacija za ${data.apartment.name} je izmenjena. Novi termini: ${formatDateSr(data.startDate)} — ${formatDateSr(data.endDate)}.`,
    }),
  ];

  if (env.ADMIN_EMAIL) {
    tasks.push(
      sendMailWithRetry({
        from: env.SMTP_FROM,
        to: env.ADMIN_EMAIL,
        subject: `[IZMENJENA] ${data.apartment.name} — ${data.guest} | ${formatDateSr(data.startDate)}`,
        text: buildAdminNotificationText(data, 'IZMENJENA'),
      }),
    );
  }

  await Promise.all(tasks);

  logger.info({ bookingId: data.id }, '✉️ Email izmene rezervacije uspešno poslat');
}

// [NOVO] Šalje adminu email kad stigne novi zahtev gosta (BUG-01 - glavna popravka)
export async function sendNewRequestToAdmin(data: RequestEmailData): Promise<void> {
  if (!transporter) {
    logger.warn(
      { requestId: data.id },
      '⚠️ Admin notifikacija nije poslata — SMTP nije konfigurisan',
    );
    return;
  }

  if (!env.ADMIN_EMAIL) {
    logger.warn(
      { requestId: data.id },
      '⚠️ ADMIN_EMAIL nije postavljen — admin neće biti obavešten o novom zahtevu',
    );
    return;
  }

  const startStr = formatDateSr(data.startDate);

  await sendMailWithRetry({
    from: env.SMTP_FROM,
    to: env.ADMIN_EMAIL,
    subject: `📬 [NOVI ZAHTEV] ${data.apartment.name} — ${data.guest} | ${startStr}`,
    text: buildAdminNewRequestText(data),
  });

  logger.info(
    { requestId: data.id, adminEmail: env.ADMIN_EMAIL },
    '✉️ Admin obavešten o novom zahtevu za rezervaciju',
  );
}

// [NOVO] Šalje gostu potvrdu da je zahtev primljen (BUG-01)
export async function sendRequestReceivedToGuest(data: RequestEmailData): Promise<void> {
  if (!transporter) {
    logger.warn(
      { requestId: data.id },
      '⚠️ Email prijema zahteva nije poslat — SMTP nije konfigurisan',
    );
    return;
  }

  await sendMailWithRetry({
    from: env.SMTP_FROM,
    to: data.email,
    subject: `📬 Zahtev primljen — ${data.apartment.name} | ${formatDateSr(data.startDate)}`,
    html: buildRequestReceivedHtml(data),
    text: `Vaš zahtev za rezervaciju apartmana ${data.apartment.name} je primljen i prosleđen na odobrenje. Odgovor očekujte u roku od 24 sata.`,
  });

  logger.info(
    { requestId: data.id, guestEmail: data.email },
    '✉️ Potvrda prijema zahteva poslata gostu',
  );
}

// [NOVO] Šalje gostu email da je zahtev odbijen (BUG-03)
export async function sendRequestRejectedToGuest(data: RequestEmailData): Promise<void> {
  if (!transporter) {
    logger.warn({ requestId: data.id }, '⚠️ Email odbijanja nije poslat — SMTP nije konfigurisan');
    return;
  }

  await sendMailWithRetry({
    from: env.SMTP_FROM,
    to: data.email,
    subject: `ℹ️ Zahtev za rezervaciju — ${data.apartment.name} | ${formatDateSr(data.startDate)}`,
    html: buildRequestRejectedHtml(data),
    text: `Nažalost, vaš zahtev za rezervaciju apartmana ${data.apartment.name} u terminu ${formatDateSr(data.startDate)} — ${formatDateSr(data.endDate)} nije odobren.`,
  });

  logger.info(
    { requestId: data.id, guestEmail: data.email },
    '✉️ Email odbijanja zahteva poslat gostu',
  );
}

export async function verifySmtpConnection(): Promise<boolean> {
  if (!transporter) return false;

  try {
    await transporter.verify();
    logger.info('✅ SMTP konekcija uspešno verifikovana');
    return true;
  } catch (err) {
    logger.error({ err }, '❌ SMTP konekcija nije uspela — provjeri SMTP_ env varijable');
    return false;
  }
}
