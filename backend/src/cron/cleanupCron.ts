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
import { appCache, CACHE_KEYS } from '../utils/cache';

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

  cron.schedule('0 * * * *', async () => {
    logger.info('⏰ Cron start: čišćenje isteklih zahteva za rezervaciju...');

    try {
      const now = new Date();

      // ─── Soft delete: PENDING → EXPIRED ──────────────────────────────────
      //
      // Kriteriji za EXPIRED:
      //   • expiresAt < now     → rok je prošao
      //   • status PENDING_*    → zahtev još nije obrađen
      //
      // APPROVED i REJECTED zahtevi se ne diraju — već su obrađeni.
      const updated = await prisma.reservationRequest.updateMany({
        where: {
          expiresAt: { lt: now },
          status: { in: ['PENDING_EMAIL', 'PENDING_APPROVAL'] },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      // ─── Alternativa: Hard delete (trajno brisanje) ───────────────────────
      //
      // Ako istorija nije potrebna, otkomentarišite ovo i uklonite soft delete gore:
      //
      // const deleted = await prisma.reservationRequest.deleteMany({
      //   where: {
      //     expiresAt: { lt: now },
      //     status: { in: ['PENDING_EMAIL', 'PENDING_APPROVAL'] }
      //   }
      // });
      // logger.info(`✅ Cron završen. Obrisano ${deleted.count} isteklih zahteva.`);

      if (updated.count > 0) {
        appCache.del(CACHE_KEYS.PENDING_REQUESTS);
        logger.info(
          { count: updated.count },
          '✅ Cron završen — istekli zahtevi označeni kao EXPIRED',
        );
      } else {
        // Debug nivo — nema svrhe logirati svaki sat da nema ništa za čistiti
        logger.debug('✅ Cron završen — nema isteklih zahteva');
      }
    } catch (error: unknown) {
      // ─── Graceful handling: Tabela ne postoji u bazi ─────────────────────
      // Čistimo proveri tipa bez labavog 'as { code?: string }' kastovanja
      const hasErrorCode = error && typeof error === 'object' && 'code' in error;
      const isTableMissingError = hasErrorCode && (error as { code: string }).code === 'P2021';
      const isMissingMessage = error instanceof Error && error.message.includes('does not exist');

      if (isTableMissingError || isMissingMessage) {
        logger.warn(
          '⚠️ ReservationRequest tabela ne postoji u bazi — preskačem cron do sledeće migracije.',
        );
        return;
      }

      // ─── Sve ostale greške su stvarni problemi ────────────────────────────
      //
      // Primer: baza je nedostupna, network timeout, lock timeout...
      // Logujemo kao ERROR da monitoring sistem može reagovati.
      // Ne rušimo server — cron će probati ponovo za sat.
      const poruka = error instanceof Error ? error.message : 'Nepoznata greška';
      logger.error({ err: error }, `❌ Cron greška pri čišćenju isteklih zahteva: ${poruka}`);
    }
  });

  logger.info('⏰ Cron zadatak registrovan: čišćenje isteklih zahteva (svaki sat)');
};
