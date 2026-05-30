// =============================================================================
// 📊 backend/src/utils/excelExport.ts
// =============================================================================
//
// Generiše Excel backup fajl sa svim aktivnim rezervacijama.
// Poziva se automatski posle svake promene u bookingu (create, update, delete).
//
// Fajlovi se čuvaju u: backend/backups/bookings-YYYY-MM-DD_HH-MM-SS.xlsx
// Čuva se maksimalno MAX_BACKUP_FILES fajlova — stariji se automatski brišu.
// =============================================================================

import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/prisma';
import { logger } from './logger';

const BACKUP_DIR = path.join(__dirname, '../../backups');
const MAX_BACKUP_FILES = 50; // Čuvamo poslednjih 50 verzija

// Kolone u Excel fajlu
const COLUMNS: ExcelJS.Column[] = [
  { header: 'ID', key: 'id', width: 30 },
  { header: 'Apartman', key: 'apartmentName', width: 20 },
  { header: 'Gost', key: 'guest', width: 25 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Telefon', key: 'phone', width: 18 },
  { header: 'Početak', key: 'startDate', width: 14 },
  { header: 'Kraj', key: 'endDate', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Kreirano', key: 'createdAt', width: 20 },
  { header: 'Izmenjeno', key: 'updatedAt', width: 20 },
] as ExcelJS.Column[];

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // yyyy-MM-dd
}

function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' '); // yyyy-MM-dd HH:mm:ss
}

/**
 * Briše stare backup fajlove ako ih ima više od MAX_BACKUP_FILES.
 */
function pruneOldBackups(): void {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('bookings-') && f.endsWith('.xlsx'))
      .map((f) => ({ name: f, path: path.join(BACKUP_DIR, f) }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sortiraj po imenu (= po vremenu)

    if (files.length > MAX_BACKUP_FILES) {
      const toDelete = files.slice(0, files.length - MAX_BACKUP_FILES);
      for (const f of toDelete) {
        fs.unlinkSync(f.path);
        logger.debug(`🗑️ Obrisan stari backup: ${f.name}`);
      }
    }
  } catch (err) {
    logger.warn({ err }, '⚠️ excelExport — greška pri brisanju starih backupa');
  }
}

/**
 * Generiše Excel fajl sa svim rezervacijama (CONFIRMED + CANCELLED).
 * Poziva se kao "fire and forget" — greška ne blokira HTTP odgovor.
 *
 * @param trigger Kratki opis akcije koja je pokrenula backup (za log)
 */
async function generateBookingExcel(trigger: string): Promise<void> {
  try {
    // 1. Kreiranje backup direktorijuma ako ne postoji
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // 2. Dohvatanje svih rezervacija iz baze
    const bookings = await prisma.booking.findMany({
      include: { apartment: { select: { name: true } } },
      orderBy: [{ startDate: 'asc' }, { apartmentId: 'asc' }],
    });

    // 3. Pravljenje Excel workbook-a
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Booking App';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Rezervacije');
    sheet.columns = COLUMNS;

    // Stil zaglavlja
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' }, // plava
    };
    headerRow.alignment = { horizontal: 'center' };

    // 4. Popunjavanje redova
    for (const b of bookings) {
      const row = sheet.addRow({
        id: b.id,
        apartmentName: b.apartment?.name ?? b.apartmentId,
        guest: b.guest,
        email: b.email,
        phone: b.phone || '',
        startDate: formatDate(b.startDate),
        endDate: formatDate(b.endDate),
        status: b.status,
        createdAt: formatDateTime(b.createdAt),
        updatedAt: formatDateTime(b.updatedAt),
      });

      // Obojena ćelija statusa
      const statusCell = row.getCell('status');
      if (b.status === 'CONFIRMED') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1FAE5' }, // zelena
        };
        statusCell.font = { color: { argb: 'FF065F46' } };
      } else {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' }, // crvena
        };
        statusCell.font = { color: { argb: 'FF991B1B' } };
      }
    }

    // 5. Metadata sheet sa info o exportu
    const metaSheet = workbook.addWorksheet('Info');
    metaSheet.addRow(['Generisano', formatDateTime(new Date())]);
    metaSheet.addRow(['Pokrenuto akcijom', trigger]);
    metaSheet.addRow(['Ukupno rezervacija', bookings.length]);
    metaSheet.addRow(['CONFIRMED', bookings.filter((b) => b.status === 'CONFIRMED').length]);
    metaSheet.addRow(['CANCELLED', bookings.filter((b) => b.status === 'CANCELLED').length]);
    metaSheet.columns = [
      { key: 'label', width: 25 },
      { key: 'value', width: 30 },
    ];

    // 6. Čuvanje fajla sa timestampom u imenu
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const filename = `bookings-${timestamp}.xlsx`;
    const filepath = path.join(BACKUP_DIR, filename);

    await workbook.xlsx.writeFile(filepath);
    logger.info({ filename, total: bookings.length, trigger }, '📊 Excel backup generisan');

    // 7. Brisanje starih backupa
    pruneOldBackups();
  } catch (err) {
    // Greška u exportu NE sme da baci izuzetak — samo logujemo
    logger.error({ err, trigger }, '❌ excelExport — greška pri generisanju backupa');
  }
}

let excelDebounceTimeout: NodeJS.Timeout | null = null;

export const triggerDebouncedExcelBackup = (contextDescription: string) => {
  const DEBOUNCE_DELAY_MS = 5000; // 5-second cooldown window

  // If a mutation occurs during an active countdown loop, evict the stale schedule instantly
  if (excelDebounceTimeout) {
    clearTimeout(excelDebounceTimeout);
  }

  // Reschedule the execution task to run 5 seconds after the final mutation
  excelDebounceTimeout = setTimeout(async () => {
    try {
      logger.info(
        { contextDescription },
        '📊 [EXCEL ENGINE] Inicijalizacija debounced generisanja rezervacione rezervne kopije...',
      );

      // Invoke your original generation file handler function here
      await generateBookingExcel(`Sistem konsolidovan: ${contextDescription}`);

      logger.info('📊 [EXCEL ENGINE] Excel backup fajl uspešno upisan na disk.');
    } catch (err) {
      logger.error({ err }, '❌ [EXCEL ENGINE CRITICAL ERROR] Neuspešno generisanje Excel fajla');
    } finally {
      excelDebounceTimeout = null; // Flush reference handle layout cleanly
    }
  }, DEBOUNCE_DELAY_MS);
};
