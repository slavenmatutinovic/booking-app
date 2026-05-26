// 🚀 Ručno učitavamo .env fajl pre nego što se bilo šta drugo pokrene
import dotenv from 'dotenv';
import path from 'path';
import { logger } from './logger'; // Uvoz logger-a za eventualno logovanje grešaka tokom seed procesa
// Eksplicitno govorimo dotenv-u da pročita .env fajl iz korenskog backend foldera
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// Uzimamo proverenu varijablu iz process.env
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  logger.error('❌ Greška: DATABASE_URL nije pronađen u vašem .env fajlu!');
  process.exit(1);
}

// Pravimo standardnu konekciju za PostgreSQL bazu (Zahtev za Prisma 7)
const pool = new pg.Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const adminPassword = process.env.ADMIN_SEED_PASSWORD;

if (!adminPassword || adminPassword.length < 4) {
  logger.error('❌ ADMIN_SEED_PASSWORD nije postavljen ili je prekratak (min 4 znakova)!');
  process.exit(1);
}

// Podaci o apartmanima koji idu u bazu (zamenjuju hardkodovane podatke u frontendu)
const APARTMENT_SEED_DATA = [
  { name: 'Apartment 1', description: 'Jednosoban apartman — prizemlje' },
  { name: 'Apartment 2', description: 'Jednosoban apartman — prvi sprat' },
  { name: 'Apartment 3', description: 'Dvosoban apartman — prizemlje' },
  { name: 'Apartment 4', description: 'Dvosoban apartman — prvi sprat' },
  { name: 'Apartment 5', description: 'Studio — pogled na more' },
  { name: 'Apartment 6', description: 'Studio — pogled na baštu' },
  { name: 'Apartment 7', description: 'Trosoban apartman — penthouse' },
  { name: 'Apartment 8', description: 'Jednosoban apartman — prizemlje, porodični' },
  { name: 'Apartment 9', description: 'Dvosoban apartman — terasa' },
  { name: 'Apartment 10', description: 'Lux apartman — panorama' },
];

// Inicijalni podaci o rezervacijama sa frontenda (start/end stringovi)
const INITIAL_BOOKINGS_DATA = [
  { apartmentName: 'Apartment 1', start: '2026-05-01', end: '2026-05-05', guest: 'John Smith' },
  { apartmentName: 'Apartment 3', start: '2026-05-08', end: '2026-05-11', guest: 'Anna Müller' },
  { apartmentName: 'Apartment 5', start: '2026-05-12', end: '2026-05-18', guest: 'Michael Chen' },
  { apartmentName: 'Apartment 2', start: '2026-05-03', end: '2026-05-07', guest: 'Sofia Rossi' },
  { apartmentName: 'Apartment 7', start: '2026-05-14', end: '2026-05-20', guest: 'Luka Marić' },
];

async function main() {
  logger.info('🌱 Pokretanje seed procesa...');

  // ── Admin korisnik ────────────────────────────────────────────────────────
  const adminEmail = 'admin@booking.local';
  const hashedPassword = await bcrypt.hash(adminPassword || '', 12); // 12 rundi umesto 10

  // Idempotentno kreiranje admina (ako postoji, preskače, ako ne - pravi)
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      role: 'ADMIN', // Mora se poklapati sa ADMIN ulogom iz šeme
    },
  });

  logger.info(`✅ Korisnik ${admin.email} je uspešno kreiran/proveren u bazi podataka.`);

  // ── Apartmani ──────────────────────────────────────────────────────────────
  // Mapiraćemo imena apartmana u njihove novokreirane ID-eve radi lakšeg vezivanja rezervacija
  const apartmentNameToIdMap: Record<string, string> = {};

  for (const apt of APARTMENT_SEED_DATA) {
    const created = await prisma.apartment.upsert({
      where: { name: apt.name },
      update: { description: apt.description },
      create: { name: apt.name, description: apt.description },
    });

    // Čuvamo generisani id (cuid) vezan za ime apartmana
    apartmentNameToIdMap[created.name] = created.id;
    logger.info(`🏠 Apartman: ${created.name} (${created.id})`);
  }

  // ── Rezervacije (Bookings) ──────────────────────────────────────────────────
  logger.info('📅 Seovanje rezervacija...');

  for (const [index, b] of INITIAL_BOOKINGS_DATA.entries()) {
    // Pronalazimo pravi ID apartmana iz naše mape na osnovu njegovog imena
    const targetApartmentId = apartmentNameToIdMap[b.apartmentName];

    if (!targetApartmentId) {
      logger.warn(
        `⚠️ Preskačem rezervaciju za gosta ${b.guest} jer apartman "${b.apartmentName}" nije pronađen.`,
      );
      continue;
    }

    // Kreiramo stabilan ID za rezervaciju (npr. seed-b1, seed-b2...) kako bi upsert bio idempotentni
    const bookingSeedId = `seed-b${index + 1}`;

    await prisma.booking.upsert({
      where: { id: bookingSeedId },
      update: {}, // Ako već postoji u bazi, ne prepisuj ništa
      create: {
        id: bookingSeedId,
        apartmentId: targetApartmentId, // Povezano preko pravog ID-ja iz baze
        guest: b.guest,
        phone: '+381601234567', // Obavezno polje iz vaše Prisma šeme
        email: `${b.guest.toLowerCase().replace(' ', '')}@booking.local`, // Opciono polje
        startDate: new Date(b.start), // Konverzija stringa u DateTime objekat
        endDate: new Date(b.end), // Konverzija stringa u DateTime objekat
        status: 'CONFIRMED', // Podrazumevani status iz enuma
      },
    });

    logger.info(`✔️ Rezervacija: Gosti "${b.guest}" -> ${b.apartmentName}`);
  }

  logger.info('✅ Seed završen!');

  logger.info('💡 Pokrenite aplikaciju i prijavite se sa: admin@booking.local');
}

main()
  .catch((e) => {
    logger.error({ err: e }, '❌ Greška tokom seed skripte');
    process.exit(1);
  })
  .finally(async () => {
    // Zatvaramo konekcije i oslobađamo terminal
    await prisma.$disconnect();
    await pool.end();
  });
