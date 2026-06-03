// =============================================================================
// ⏰ backend/src/cron/cleanupCron.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  AUTOMATSKO ČIŠĆENJE ISTEKLIH ZAHTEVA                                   │
// │                                                                         │
// │  Pokreće se na svakom punom satu (cron: "0 * * * *").                  │
// │  Označava zahteve koji su prošli expiresAt a nisu obrađeni kao EXPIRED. │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 ŽIVOTNI CIKLUS ZAHTEVA:
//
//   Gost pošalje zahtev
//       │
//       ▼
//   PENDING_APPROVAL  ←── Admin ga vidi, može odobriti/odbiti
//       │
//       ├─▶ APPROVED  ←── Admin odobrio → kreira se Booking
//       │
//       ├─▶ REJECTED  ←── Admin odbio → gost dobija email
//       │
//       └─▶ EXPIRED   ←── Ovaj cron: expiresAt prošao, niko nije reagovao
//
// ⏰ RASPORED IZVRŠAVANJA:
//
//   "0 * * * *" = na početku svakog sata (0 minuta, svaki sat)
//   Primeri: 01:00, 02:00, 03:00...
//
//   Zašto ne češće?
//   • Zahtevi isteku za 24h — provjera na sat je sasvim dovoljna preciznost
//   • Smanjuje nepotreban pritisak na bazu
//   • Ako cron zakaže 1-2 puta (restart servera), nema štete
//
// 🔒 BEZBEDNOSNA NAPOMENA — Greška P2021:
//
//   Kod hvatamo specifičan Prisma error P2021 (tabela ne postoji).
//   Ovo se dešava ako cron poradi pre nego što se migracije pokrenu.
//   Umesto da srušimo server, logujemo upozorenje i preskočimo iteraciju.
//   Server nastavlja da radi normalno — migracija se može pokrenuti posle.
//
// =============================================================================

import cron from 'node-cron';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { appCache, CACHE_KEYS, invalidateBookingCache } from '../utils/cache';

// =============================================================================
// ⏰ INICIJALIZACIJA CRON ZADATKA
// =============================================================================

/**
 * Registruje cron zadatak za čišćenje isteklih zahteva.
 * Poziva se jednom pri pokretanju servera (u server.ts).
 *
 * Dizajnerska odluka — Soft delete umesto Hard delete:
 *   Menjamo status u EXPIRED umesto da brišemo redove iz baze.
 *   Razlozi:
 *   1. Istorija zahteva ostaje sačuvana (za izvještaje/analitiku)
 *   2. Lakše otklanjanje grešaka ("Zašto ovaj zahtev nije odobren?")
 *   3. Nema problema sa stranim ključevima (ako se doda relacija)
 *
 *   Za Hard delete, videti zakomentarisan blok ispod.
 */
export const initCleanupCron = () => {
  // Provjera ispravnosti cron izraza pri pokretanju — bolje je odmah znati
  // da je izraz neispravan nego čekati sat vremena da cron "propusti" izvršavanje
  if (!cron.validate('0 * * * *')) {
    logger.error('❌ Neispravan cron izraz — cron zadatak NEĆE biti registrovan!');
    return;
  }
  // 🔄 1. Registracija satnog rasporeda ("Na svaki pun sat")
  cron.schedule('0 * * * *', async () => {
    await executeCleanup();
  });

  // Ne čekamo da prođe prvih sat vremena.
  executeCleanup().catch((err) => logger.error({ err }, 'Greška pri inicijalnom čišćenju'));

  logger.info('⏰ Cron zadatak registrovan: čišćenje isteklih zahteva (svaki sat)');
};

// =============================================================================
// ⏰ GLAVNA FUNKCIJA ZA ČIŠĆENJE (Može se zvati sa više mesta)
// =============================================================================
async function executeCleanup(): Promise<void> {
  logger.info('⏰ Pokrećem čišćenje isteklih zahteva za rezervaciju...');

  try {
    const now = new Date();

    // ─── Soft delete: PENDING → EXPIRED ──────────────────────────────────
    // Kriterijumi za EXPIRED:
    //   • expiresAt < now                  → rok za verifikaciju/odobrenje je prošao
    //   • status PENDING_EMAIL / APPROVAL  → zahtev još uvek nije finalizovan
    const updated = await prisma.reservationRequest.updateMany({
      where: {
        expiresAt: { lt: now },
        status: { in: ['PENDING_EMAIL', 'PENDING_APPROVAL'] },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    if (updated.count > 0) {
      // 1. Brišemo admin listu zahteva na čekanju iz keša
      appCache.del(CACHE_KEYS.PENDING_REQUESTS);

      // ✅ 2. PRAVILNA INVALIDACIJA: Brišemo sve dinamičke opsege meseci.
      // Oslobađamo datume na kalendaru za nove goste istog milisekundnog trena!
      invalidateBookingCache();

      logger.info(
        { count: updated.count },
        '✅ Čišćenje završeno — istekli zahtevi prebačeni u EXPIRED i kalendarski keš oslobođen.',
      );
    } else {
      // Koristimo debug nivo da ne bismo zatrpavali produkcione logove svakih sat vremena
      logger.debug('✅ Čišćenje završeno — nema isteklih zahteva u ovom krugu.');
    }
  } catch (error: unknown) {
    // ─── Graceful handling: Tabela još ne postoji u bazi ─────────────────────
    // Sprečava pad servera ako cron opali pre nego što CI/CD izvrši migracije
    const hasErrorCode = error && typeof error === 'object' && 'code' in error;
    const isTableMissingError = hasErrorCode && (error as { code: string }).code === 'P2021';
    const isMissingMessage = error instanceof Error && error.message.includes('does not exist');

    if (isTableMissingError || isMissingMessage) {
      logger.warn(
        '⚠️ ReservationRequest tabela ne postoji u bazi — preskačem čišćenje do sledeće migracije.',
      );
      return;
    }

    // ─── Sve ostale greške su stvarni infrastrukturni problemi ────────────────
    const poruka = error instanceof Error ? error.message : 'Nepoznata greška';
    logger.error({ err: error }, `❌ Kritična greška tokom izvršavanja čišćenja: ${poruka}`);
  }
}
