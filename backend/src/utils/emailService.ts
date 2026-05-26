/**
 * emailService.ts — Nodemailer servis za slanje notifikacija rezervacija.
 *
 * Odgovornosti:
 *   • Inicijalizacija Nodemailer transporta iz env varijabli (jednom pri pokretanju)
 *   • Slanje potvrde rezervacije gostu i adminu
 *   • Slanje obaveštenja o otkazivanju gostu i adminu
 *   • Graceful degradacija: ako SMTP nije konfigurisan, loguje upozorenje i nastavlja
 *
 * Dizajnerska odluka — Fire & Forget:
 *   Slanje emaila se poziva bez `await` u controllerima:
 *     sendBookingConfirmation(booking).catch(err => logger.error(err))
 *   Ovo znači da greška u slanju emaila ne blokira HTTP odgovor klijentu.
 *   Gost dobija potvrdu rezervacije odmah, a email stiže u pozadini.
 *
 * Podržani SMTP provajderi:
 *   • Gmail (smtp.gmail.com:587) — potreban App Password, ne prava lozinka
 *   • Mailtrap sandbox — za development testiranje bez stvarnog slanja
 *   • SendGrid, Mailgun, Amazon SES — standardni SMTP interfejsi
 *   • Sopstveni SMTP server — bilo koji provajder
 */

import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

// =============================================================================
// 📧 TIPOVI
// =============================================================================

/**
 * Minimalni podaci o rezervaciji koji su potrebni za email notifikacije.
 * Namerno ograničen skup — ne prosleđujemo ceo Prisma model.
 */
export interface BookingEmailData {
  id: string;
  guest: string;
  email: string; // Obavezan — email je sada required polje u rezervaciji
  phone?: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  apartment: {
    id: string;
    name: string;
  };
}

// =============================================================================
// 🔌 INICIJALIZACIJA TRANSPORTA
// =============================================================================

/**
 * Kreira Nodemailer transporter ili null ako SMTP nije konfigurisan.
 *
 * null nije greška — omogućava pokretanje aplikacije bez email konfiguracije
 * (npr. u test okruženju). Sve funkcije proveravaju transporter pre slanja.
 */
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
    secure: env.SMTP_SECURE, // true za port 465 (SSL), false za 587 (STARTTLS)
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    // Timeout za konekciju — ne čekaj beskonačno ako je SMTP nedostupan
    connectionTimeout: 5000,
    greetingTimeout: 3000,
  });

  return transporter;
}

// Singleton transporter — kreira se jednom pri pokretanju modula
const transporter = createTransporter();

// =============================================================================
// 🧮 HELPER FUNKCIJE
// =============================================================================

/**
 * Formatira datum u čitljiv srpski format: "15. jun 2026."
 */
function formatDateSr(date: Date): string {
  return date.toLocaleDateString('sr-RS', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Računa broj noći između dva datuma.
 */
function calcNights(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

// =============================================================================
// 🎨 EMAIL TEMPLATE-I
// =============================================================================

/**
 * HTML template za potvrdu rezervacije (šalje se gostu).
 *
 * Dizajn:
 *   • Maksimalna kompatibilnost — inline CSS, bez Flexbox/Grid
 *   • Funkcioniše u Gmail, Outlook, Apple Mail
 *   • Mobile-friendly (max-width: 600px)
 */
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

        <!-- Glavni kontejner -->
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
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

          <!-- Sadržaj -->
          <tr>
            <td style="padding: 40px;">

              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${data.guest}</strong>,
              </p>

              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Vaša rezervacija je uspešno potvrđena. U nastavku se nalaze detalji:
              </p>

              <!-- Detalji rezervacije -->
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
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${startStr}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${endStr}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">🌙 Broj noći:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${nights}</td>
                      </tr>
                      ${
                        data.phone
                          ? `
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📞 Telefon:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${data.phone}</td>
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

          <!-- Footer -->
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
 * HTML template za obaveštenje o otkazivanju rezervacije (šalje se gostu).
 */
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

          <!-- Header -->
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

          <!-- Sadržaj -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin:0 0 24px; color:#374151; font-size:16px; line-height:1.6;">
                Poštovani/a <strong>${data.guest}</strong>,
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
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${data.apartment.name}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Dolazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${startStr}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:14px;">📅 Odlazak:</td>
                        <td style="padding:8px 0; color:#111827; font-size:14px; font-weight:600;">${endStr}</td>
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

          <!-- Footer -->
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
 * Tekst email za admina — kompaktan, samo bitne informacije.
 */
function buildAdminNotificationText(
  data: BookingEmailData,
  eventType: 'NOVA' | 'OTKAZANA',
): string {
  const nights = calcNights(data.startDate, data.endDate);
  const startStr = formatDateSr(data.startDate);
  const endStr = formatDateSr(data.endDate);

  return `
[${eventType} REZERVACIJA] ID: ${data.id}

Apartman  : ${data.apartment.name}
Gost      : ${data.guest}
Email     : ${data.email}
Telefon   : ${data.phone || 'Nije uneto'}
Dolazak   : ${startStr}
Odlazak   : ${endStr}
Noći      : ${nights}
Status    : ${data.status}
  `.trim();
}

// =============================================================================
// 📤 JAVNE FUNKCIJE ZA SLANJE
// =============================================================================

/**
 * Šalje email potvrde rezervacije.
 *
 * Primaoci:
 *   1. Gost (data.email) — lepši HTML template sa detaljima
 *   2. Admin (env.ADMIN_EMAIL) — kratak tekstualni pregled
 *
 * @throws Baca grešku ako SMTP nije konfigurisan ili slanje ne uspe.
 *         Caller treba da uhvati grešku i loguje (ne da blokira HTTP odgovor).
 */
export async function sendBookingConfirmation(data: BookingEmailData): Promise<void> {
  if (!transporter) {
    logger.warn({ bookingId: data.id }, '⚠️ Email potvrde nije poslat — SMTP nije konfigurisan');
    return;
  }

  const subject = `✅ Potvrda rezervacije — ${data.apartment.name} | ${formatDateSr(data.startDate)}`;

  // Paralelno slanje gostu i adminu — brže od sekvencijalnog
  const tasks: Promise<unknown>[] = [
    // Email gostu
    transporter.sendMail({
      from: env.SMTP_FROM,
      to: data.email,
      subject,
      html: buildConfirmationEmailHtml(data),
      // Plain text fallback za email klijente koji ne renderuju HTML
      text: `Rezervacija potvrđena za ${data.apartment.name} od ${formatDateSr(data.startDate)} do ${formatDateSr(data.endDate)}.`,
    }),
  ];

  // Email adminu (samo ako je ADMIN_EMAIL konfigurisan)
  if (env.ADMIN_EMAIL) {
    tasks.push(
      transporter.sendMail({
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

/**
 * Šalje email obaveštenja o otkazivanju rezervacije.
 *
 * Primaoci:
 *   1. Gost (data.email) — obaveštenje da je rezervacija otkazana
 *   2. Admin (env.ADMIN_EMAIL) — informacija o otkazivanju
 *
 * @throws Baca grešku ako slanje ne uspe.
 */
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
    // Email gostu
    transporter.sendMail({
      from: env.SMTP_FROM,
      to: data.email,
      subject,
      html: buildCancellationEmailHtml(data),
      text: `Vaša rezervacija za ${data.apartment.name} od ${formatDateSr(data.startDate)} do ${formatDateSr(data.endDate)} je otkazana.`,
    }),
  ];

  if (env.ADMIN_EMAIL) {
    tasks.push(
      transporter.sendMail({
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

/**
 * Provjera konekcije sa SMTP serverom (koristiti pri pokretanju servera).
 *
 * @returns true ako je konekcija uspešna, false ako SMTP nije konfigurisan ili greška.
 *
 * @example
 * // U server.ts pri pokretanju:
 * const emailOk = await verifySmtpConnection();
 * if (!emailOk) logger.warn('Email notifikacije su onemogućene');
 */
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
