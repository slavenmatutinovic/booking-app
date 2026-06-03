import cron from 'node-cron';
import { promises as fs } from 'fs';
import path from 'path';
import { Workbook } from 'exceljs';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';

// Jedinstveni krovni direktorijum za sve bekapi na serveru
const BACKUP_DIR = path.join(__dirname, '../../backups');

// =============================================================================
// ⚙️ POMOĆNI SERVISI ZA GENERISANJE PODATAKA
// =============================================================================

/**
 * 📝 Priprema JSON strukturu sa svim tabelama iz baze podataka.
 */
async function generateJsonData(): Promise<string> {
  const [users, apartments, bookings, requests] = await Promise.all([
    prisma.user.findMany(),
    prisma.apartment.findMany(),
    prisma.booking.findMany(),
    prisma.reservationRequest.findMany(),
  ]);

  const backupObj = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    tables: {
      users,
      apartments,
      bookings,
      reservationRequests: requests,
    },
  };

  return JSON.stringify(backupObj, null, 2);
}

/**
 * 📊 Priprema Excel radnu svesku (Workbook) koristeći cursor-based paginaciju.
 */
async function generateExcelWorkbook(): Promise<Workbook> {
  try {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Izveštaj Rezervacija');

    worksheet.columns = [
      { header: 'ID Rezervacije', key: 'id', width: 36 },
      { header: 'Apartman', key: 'apartmentName', width: 20 },
      { header: 'Gost (Ime)', key: 'guest', width: 25 },
      { header: 'Email Adresa', key: 'email', width: 25 },
      { header: 'Broj Telefona', key: 'phone', width: 18 },
      { header: 'Datum Dolaska', key: 'startDate', width: 15 },
      { header: 'Datum Odlaska', key: 'endDate', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Kreirano', key: 'createdAt', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };

    // 🔄 2. Podešavanje parametara za stabilnu paginaciju u blokovima
    let hasMore = true;
    let currentCursor: string | undefined = undefined;
    const BATCH_SIZE = 1000;
    let totalProcessed = 0;

    // 🚀 3. Strimovanje podataka kroz petlju (Batch Processing)
    while (hasMore) {
      // Izgradnja osnovne konfiguracije objekta
      const queryArgs: Prisma.BookingFindManyArgs = {
        take: BATCH_SIZE,
        orderBy: { id: 'asc' }, // Unikatno polje garantuje stabilan kursor
        include: {
          apartment: {
            select: { name: true },
          },
        },
      };

      // ✅ REŠENJE ZA SLOMIDLO (exactOptionalPropertyTypes):
      // Umesto da dodelimo 'undefined' ključ, mi polja 'cursor' i 'skip'
      // dodajemo u objekat SAMO ako kursor stvarno postoji iz prethodne iteracije.
      if (currentCursor) {
        queryArgs.cursor = { id: currentCursor };
        queryArgs.skip = 1;
      }

      const rawBookings = await prisma.booking.findMany(queryArgs);

      // Bezbedno izvršavanje upita sa čistim Prisma tipovima
      const batchBookings = rawBookings as Prisma.BookingGetPayload<{
        include: { apartment: { select: { name: true } } };
      }>[];

      // Ako je baza prazna ili smo obradili sve zapise, prekidamo petlju
      if (batchBookings.length === 0) {
        hasMore = false;
        break;
      }

      batchBookings.forEach((b) => {
        worksheet.addRow({
          id: b.id,
          apartmentName: b.apartment?.name || 'Nije dodeljen',
          guest: b.guest,
          email: b.email,
          phone: b.phone || '/',
          startDate: b.startDate.toISOString().split('T')[0],
          endDate: b.endDate.toISOString().split('T')[0],
          status: b.status,
          createdAt: b.createdAt.toISOString().replace('T', ' ').substring(0, 19),
        });
      });

      totalProcessed += batchBookings.length;

      // Pomeramo kursor pokazivača na poslednji element iz ovog uspešnog bloka
      const lastItem = batchBookings[batchBookings.length - 1];
      currentCursor = lastItem?.id;

      // Ako je Prisma vratila manje zapisa od traženog limita, stigli smo do kraja tabele
      if (batchBookings.length < BATCH_SIZE) {
        hasMore = false;
      }
    }
    logger.info(
      { totalProcessed },
      '✅ Excel tabela uspešno generisana, započinjem prenos ka klijentu...',
    );

    return workbook;
  } catch (error) {
    logger.error({ err: error }, '❌ Kritična greška tokom generisanja Excel izveštaja');
    throw error;
  }
}

// =============================================================================
// 🧹 AUTOMATSKO ČIŠĆENJE STAROG SADRŽAJA
// =============================================================================

/**
 * Uklanja sve bekap fajlove (JSON i XLSX) starije od 7 dana.
 */
async function cleanupOldBackups(): Promise<void> {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('backup_') && (file.endsWith('.json') || file.endsWith('.xlsx'))) {
        const filePath = path.join(BACKUP_DIR, file);
        const stat = await fs.stat(filePath);

        if (now - stat.mtimeMs > SEVEN_DAYS_MS) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`🧹 Automatska higijena: Obrisano ${deletedCount} starih fajlova sa servera.`);
    }
  } catch (error) {
    logger.error({ err: error }, '⚠️ Greška tokom čišćenja stare arhive.');
  }
}

// =============================================================================
// ⏰ KROVNA FUNKCIJA I CRON RASPODELJIVAČ
// =============================================================================

/**
 * Pokreće ujedinjeni proces kreiranja foldera, generisanja i paralelnog upisa.
 */
export const runCombinedBackup = async (ifupdate?: string): Promise<void> => {
  if (!ifupdate) {
    logger.info('⏰ Pokrećem kompletan noćni bekap sistem (JSON + Excel)...');
  } else {
    logger.info(`⏰ Pokrećem bekap sistem zbog izmene: ${ifupdate} (JSON + Excel)...`);
  }

  try {
    // 1. ✅ ZAJEDNIČKA PROVERA DIREKTORIJUMA (Samo jednom na serveru)
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    logger.info({ path: BACKUP_DIR }, '📁 Bekap direktorijum je spreman na serveru');

    // 2. ⚡ PARALELNO GENERISANJE PODATAKA (U radnoj memoriji)
    const [jsonString, excelWorkbook] = await Promise.all([
      generateJsonData(),
      generateExcelWorkbook(),
    ]);

    // 3. 🎯 IDENTIČAN TIMESTAMPO ZA OBA FAJLA
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const jsonPath = path.join(BACKUP_DIR, `backup_${timestamp}.json`);
    const excelPath = path.join(BACKUP_DIR, `backup_${timestamp}.xlsx`);

    // 4. 📝 PARALELAN ASINHRONI UPIS NA ČVRSTI DISK SERVERA
    await Promise.all([
      fs.writeFile(jsonPath, jsonString, 'utf-8'),
      excelWorkbook.xlsx.writeFile(excelPath),
    ]);

    logger.info(`✅ Uspešno upisani fajlovi na disk:\n -> ${jsonPath}\n -> ${excelPath}`);

    // 5. Pokretanje auto-čišćenja istorije
    await cleanupOldBackups();

    logger.info('✅ Kompletan noćni bekap je uspešno završen.');
  } catch (err) {
    logger.error({ err }, '❌ Noćni bekap sistem je prekinut zbog kritične greške.');
    throw err;
  }
};

/**
 * Inicijalizuje cron planer za noćni bekap i izvršava jedno "bootstrap" okidanje.
 */
export const initBackupCron = () => {
  const schedulePattern = '0 2 * * *'; // Svake noći u 02:00h

  if (!cron.validate(schedulePattern)) {
    logger.error('❌ Neispravan cron izraz za bekap sistem!');
    return;
  }

  // Registracija noćnog zadatka
  cron.schedule(schedulePattern, async () => {
    await runCombinedBackup().catch(() => {});
  });

  // 🚀 BOOTSTRAP OKIDANJE: Testiramo i osiguravamo disk odmah pri pokretanju servera
  runCombinedBackup().catch((err) =>
    logger.error({ err }, '❌ Inicijalno bootstrap kreiranje bekapa nije uspelo'),
  );

  logger.info(
    '⏰ Cron zadatak registrovan: Sinhronizovani JSON + Excel bekap (svake noći u 02:00h)',
  );
};
