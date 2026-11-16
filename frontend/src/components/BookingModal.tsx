// =============================================================================
// Okolina koda: Početak datoteke i uvozi (Obrada stanja i TypeScript ugovora)
// =============================================================================
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
// Uvozimo zajedničke tipove kako bismo spriječili dupliranje sučelja na klijentu i serveru
import type { AuthUser, ApartmentRateData } from '../../../shared/index';
// Uvozimo unutrašnje UI tipove specifične za koordinaciju kalendarske mreže
import type { SelData } from '../types/ui';
// Pomoćna funkcija za formatiranje datuma u kratki, lokalizirani string (npr. DD.MM)
import { fmtShort } from '../utils/dates';
// Pod-komponenta zadužena za dinamički prikaz strukture cijena po noćenjima unutar modala
import { BookingPricePreview } from './BookingPricePreview';

interface BookingModalProps {
  // Kontrolira vidljivost modala na ekranu (renderiranje se vrši kroz Portal)
  showModal: boolean;
  // Sadrži podatke o odabranom opsegu datuma i apartmana s kalendara
  selData: SelData | null;
  // Funkcija za poništavanje trenutnog selektiranog opsega na kalendarskoj mreži
  setSelection: (val: null) => void;
  // Glavni asinkroni okidač koji komunicira s backendom i upisuje rezervaciju u bazu
  createBooking: (
    formData: { guestName: string; email: string; phone: string; capacity: number },
    selData: SelData | null,
    totalPrice: number,
  ) => void | Promise<void>;
  // Ukupan broj apartmana u sustavu, koristi se za proračune vertikalnog pozicioniranja
  apartmentsCount: number;
  // Indeks trenutno odabranog apartmana u nizu, ključan za pronalaženje ciljnog DOM reda
  aptIdx: number;
  // Širina jednog dana (ćelije) na kalendaru u pikselima, koristi se za živu matematiku pozicije
  dayW: number;
  // Fiksna ili dinamička širina samog modala, nužna za sprječavanje "izlijetanja" s ekrana
  modalW: number;
  // Zastavica učitavanja (loading state) koja sprječava duple klikove i slanje zahtjeva
  isCreating: boolean;
  // Određuje prava pristupa (Admin stvara izravnu rezervaciju, Viewer/Gost šalje zahtjev)
  isAdmin: boolean;
  // Podaci o trenutno prijavljenom korisniku (koristi se za reaktivne tekstualne labele)
  currentUser: AuthUser | null;
  // String greške povučene izravno iz backend Express error handlera
  bookingError: string | null;
  // Cijeli niz sezonskih cijena za odabrani apartman, koristi se za izvlačenje kapaciteta
  activeRates: ApartmentRateData[];
}

export const BookingModal: React.FC<BookingModalProps> = ({
  showModal,
  selData,
  setSelection,
  createBooking,
  modalW,
  isAdmin,
  currentUser,
  bookingError,
  isCreating,
  activeRates,
  dayW,
}) => {
  // ZASTAVICA KAPACITETA: useMemo postoji kako bismo spriječili teške kalkulacije i re-rendere.
  // Skeniramo activeRates niz, vadimo jedinstvene kapacitete i sortiramo ih hronološki.
  const availableCapacities: number[] = useMemo(() => {
    // Ako apartman nema upisane sezone, vraćamo [2] kao najčešći bezbjedan fallback za krevete
    if (!activeRates || activeRates.length === 0) return [2];
    // Mapiramo strukturu u čiste brojeve kako bismo eliminirali tekstualne anomalije
    const rawCapacities = activeRates.map((rate) => Number(rate.capacity));
    // Koristimo Set objekt jer on po svojoj unutrašnjoj definiciji garantira nula dupliranih vrijednosti.
    // Ako apartman ima 5 sezonskih cijena za kapacitet 2, Set će zadržati samo jedan broj 2.
    const uniqueSet = new Set<number>(rawCapacities);

    // Pretvaramo Set natrag u čisti niz i sortiramo ga od najmanjeg prema najvećem kapacitetu.
    const sortedResult = Array.from(uniqueSet).sort((a, b) => a - b);

    // =============================================================================
    // ISPRAVLJENI I UKLOPENI KOD: Dodajemo logički fallback operator (Nullish Coalescing).
    // Ako je rezultat prazan niz iz bilo kojeg razloga, vraćamo niz s defaultnim brojem 2.
    // TypeScript sada ima 100% garanciju da funkcija nikada ne može vratiti 'undefined'!
    // =============================================================================
    return sortedResult.length > 0 ? sortedResult : [2];
  }, [activeRates]);

  // Lokalna stanja forme koja drže privremeni korisnički unos prije slanja na mrežni sloj
  const [localGuestName, setLocalGuestName] = useState('');
  const [localEmail, setLocalEmail] = useState('');
  const [localPhone, setLocalPhone] = useState('');
  const calculatedPriceRef = useRef<number | null>(null);

  // SINKRONIZACIJA KAPACITETA: Postavlja prvi (najmanji) dostupni kapacitet iz baze kao selektiran.
  const [localCapacity, setLocalCapacity] = useState<number>(() => availableCapacities[0] ?? 2);

  // Ref čuva povijest (zadnji obrađeni ID apartmana) kako bismo znali kada je korisnik kliknuo na drugi apartman
  const lastAptIdRef = useRef<string | null>(null);

  // =============================================================================
  // UKLOPENO I ISPRAVLJENO RJEŠENJE: SINKRONIZACIJA TIJEKOM RENDERIRANJA (In-render derivation).
  // Ako se promijenio aptId, odmah unutar trenutnog vala ažuriramo stanje.
  // React će presresti ovo i izvršiti samo jedan jedini optimizirani re-render,
  // čime trajno uništavamo "cascading renders" runtime upozorenje.
  // =============================================================================
  if (selData?.aptId !== lastAptIdRef.current) {
    // Bilježimo novi ID apartmana u ref povijest kako se ovaj blok ne bi vrtio u beskonačnoj petlji
    lastAptIdRef.current = selData?.aptId ?? null;

    // Sinkroniziramo kapacitet na prvu dostupnu opciju trenutnog apartmana iz SQL baze
    const nextDefaultOption = availableCapacities[0] ?? 2;
    setLocalCapacity(nextDefaultOption);
  }

  // Žive koordinate (top/left) preračunate u pikselima za apsolutno pozicioniranje na ekranu
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Ref preuzima izravnu kontrolu nad DOM elementom prvog input polja (Ime gosta)
  const localGuestRef = useRef<HTMLInputElement>(null);

  // ASINKRONI FOKUS: setTimeout od 60ms postoji jer se modal renderira asinhrono u Portal sloju.
  // Bez ove odgode, fokus bi opalio prije nego što element fizički nastane u DOM-u, što bi ga slomilo.
  useEffect(() => {
    if (!showModal) return;
    const timer = setTimeout(() => {
      localGuestRef.current?.focus();
    }, 60);
    return () => clearTimeout(timer); // Cleanup sprječava memory leak ako se modal zatvori prije isteka vremena
  }, [showModal]);

  // LIVE PORTAL POS PRORAČUN: useLayoutEffect postoji jer proračun koordinata MORA izvršiti
  // prije nego što browser nacrta (paint) modal na ekranu, čime sprječavamo ružno "skakanje" i bljeskanje.
  useLayoutEffect(() => {
    if (!showModal || !selData) return;
    const activeSelData = selData;

    function updatePosition() {
      // Tražimo sve redove na kalendaru kako bismo se zakačili za točan red apartmana
      const rowElements = document.querySelectorAll('.row');
      const targetRow = rowElements[activeSelData.aptIdx];

      if (targetRow) {
        // Uzimamo točne dimenzije i poziciju reda u odnosu na trenutni vidljivi prozor (viewport)
        const rect = targetRow.getBoundingClientRect();

        // MATEMATIKA HORIZONTALE: Računamo left poziciju tako da modal savršeno prati selekciju,
        // a Math.min/Math.max osigurava marginu od 16px od rubova ekrana da kôd ne bi pobjegao van vidokruga.
        const targetLeft = Math.min(
          Math.max(rect.left + activeSelData.left - (modalW + 2 * dayW), 16),
          window.innerWidth - modalW - 16,
        );

        // MATEMATIKA VERTIKALE: Ako modal udara u dno ekrana (targetTop + 300px procjene visine),
        // adjustedTop automatski "baca" modal IZNAD reda, sprječavajući da dugme za slanje pobjegne pod ekran.
        const adjustedTop =
          rect.top + rect.height + 6 + 300 > window.innerHeight
            ? rect.top - 306
            : rect.top + rect.height + 6;

        setCoords({ top: adjustedTop, left: targetLeft });
      }
    }

    updatePosition(); // Izvršavamo odmah pri otvaranju modala

    // Osluškujemo promjenu veličine prozora u slučaju da korisnik rasteže ili rotira ekran uređaja
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition); // Trajno uklanjanje slušača radi stabilnosti memorije
  }, [showModal, selData, modalW, dayW]);

  // Obrambeni osigurač: ako uvjeti nisu ispunjeni, prekidamo renderiranje i vraćamo prazno stablo
  if (!showModal || !selData) return null;

  // Reaktivni tekstualni natpisi koji se automatski prilagođavaju na temelju uloge prijavljenog korisnika
  const modalTitle = isAdmin ? 'Nova rezervacija' : 'Zahtev za rezervaciju';
  const buttonText = isAdmin ? 'Kreiraj rezervaciju' : 'Pošalji zahtev';
  const guestLabel = currentUser ? 'Ime gosta' : 'Vaše ime';

  // CENTRALIZIRANO ČIŠĆENJE FORME: handleClose postoji kao jedinstveni izvor istine (DRY)
  // za resetiranje svih lokalnih stanja. Poziva se i na gumb "Zatvori" i nakon uspješnog slanja.
  const handleClose = () => {
    const defaultCapacity =
      availableCapacities && availableCapacities.length > 0 ? Number(availableCapacities[0]) : 1;
    setLocalCapacity(defaultCapacity);
    setSelection(null); // Čisti selekciju na kalendaru
    setLocalGuestName('');
    setLocalEmail('');
    setLocalPhone('');
  };

  // ASINKRONI HANDSUBMIT: Koristi lokalni try-catch blok kako bi riješio kritičan race condition state bug.
  // Ako createBooking baci grešku, kôd skače u catch i forma ostaje netaknuta.
  const handleSubmit = async () => {
    // Validacijski štit: sprječavamo slanje praznih obaveznih polja ili duple klikove tijekom učitavanja
    if (!localGuestName.trim() || !localEmail.trim() || isCreating) return;

    // Ako ref sadrži null, to znači da je preview komponenta izbacio grešku (npr. nema cene u bazi)
    if (calculatedPriceRef.current === null) {
      alert('Nemoguće kreirati rezervaciju jer cena za izabrani period nije uspešno izračunata.');
      return;
    }

    try {
      // Pokrećemo slanje payload-a prema backend ruti i čekamo uspješno razrešenje Promise-a
      await createBooking(
        {
          guestName: localGuestName.trim(),
          email: localEmail.trim(),
          phone: localPhone.trim(),
          capacity: localCapacity,
        },
        selData,
        calculatedPriceRef.current,
      );

      // UKLOPENO DRY REŠENJE: Budući da kôd nije skočio u catch, slanje je uspješno prošlo.
      // Pozivamo već postojeću handleClose() koja prazni polja i zatvara modal, bez dupliranja koda!
      handleClose();
    } catch {
      // UX FOKUS: Ako je server vratio grešku (npr. zauzet termin), modal ostaje otvoren,
      // a fokus se odmah asinhrono vraća na prvo polje kako bi korisnik mogao ispraviti unos bez ponovnog klikanja.
      localGuestRef.current?.focus();
    }
  };

  // Omogućuje adminu/korisniku da potvrdi formu brzim pritiskom na gumb Enter na tipkovnici
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  // Dinamički računamo preostali prostor do dna ekrana kako bi kartica dobila skrol ako ima previše teksta
  const dynamicMaxCardHeight = coords.top > 0 ? `calc(100vh - ${coords.top}px - 25px)` : '85vh';

  // =============================================================================
  // Okolina koda: Renderovanje JSX vizuelne strukture komponente (Stranica 3-6)
  // =============================================================================
  return (
    <div
      className="modal"
      style={{
        position: 'fixed', // Ostaje fiksiran jer se renderira kroz Portal izravno unutar body oznake
        left: `${coords.left}px`, // Živi proračun pozicije usklađen sa striktnim CSS standardom
        top: `${coords.top}px`, // Živi proračun pozicije usklađen sa striktnim CSS standardom
        zIndex: 99999, // Najviši sloj na ekranu koji garantira preklapanje preko svih kalendarskih traka
      }}
      // stopPropagation postoji kako klik unutar modala ne bi reaktivno aktivirao selekciju na kalendaru ispod njega
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="modal-card"
        style={{
          maxHeight: dynamicMaxCardHeight, // Sprječava izlazak modala iz okvira ekrana
          position: 'relative',
          paddingBottom: '65px', // Fiksna margina na dnu koja pravi prazan siguran prostor za dugme
          boxSizing: 'border-box', // Uključuje padding u ukupnu visinu elementa radi stabilnosti proračuna
          overflow: 'hidden', // Sakriva unutrašnje prelijevanje kako zaobljeni rubovi kartice ne bi pukli
          display: 'block',
        }}
      >
        {/* ── Header sekcija modala ────────────────────────────────────── */}
        <div className="modal-header">
          <div>
            <div className="modal-title">{modalTitle}</div>
            <div className="modal-subtitle">
              {/* fmtShort pretvara sirovi datum u prepoznatljiv format npr. "15. Jun" */}
              {fmtShort(selData.startDate)} {' → '} {fmtShort(selData.endDate)}
              {' · '}
              {selData.totalDays} {selData.totalDays === 1 ? 'dan' : 'dana'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Broj kreveta
            </label>
            <select
              value={localCapacity}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                setLocalCapacity(Number(e.target.value));
              }}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
              }}
            >
              {/* REŠENJE ZA BAZU: Prikazujemo isključivo opcije kapaciteta koje stvarno postoje u SQL bazi za taj apartman */}
              {availableCapacities.map((cap: number) => (
                <option key={cap} value={cap}>
                  {cap} kreveta
                </option>
              ))}
            </select>
          </div>
          <button className="modal-close" onClick={handleClose} aria-label="Zatvori modal">
            ×
          </button>
        </div>

        {/* ── Banner za prikaz grešaka ─────────────────────────────────── */}
        {/* Prikazuje se dinamički samo ako je zajednički klijentski hook uhvatio grešku sa servera */}
        {bookingError && <div className="modal-notice modal-notice--error">⚠ {bookingError}</div>}

        {/* ── Informativne napomene prilagođene ulogama korisnika ───────── */}
        {!currentUser && (
          <div className="modal-notice modal-notice--info">💡 Vaš zahtev će biti proslijeđen.</div>
        )}
        {currentUser && !isAdmin && (
          <div className="modal-notice modal-notice--viewer">
            📬 Vaš zahtev će biti proslijeđen adminu na odobrenje.
          </div>
        )}

        {/* ── Polja forme za unos podataka gosta ───────────────────────── */}
        <input
          ref={localGuestRef} // Vezujemo ref kako bismo asinhrono aktivirali fokus pri otvaranju
          className="guest-input"
          placeholder={guestLabel}
          value={localGuestName}
          onChange={(e) => setLocalGuestName(e.target.value)}
          onKeyDown={handleKey}
          disabled={isCreating} // Blokiramo polje tijekom mrežnog slanja radi sprječavanja korupcije podataka
          aria-label={guestLabel}
        />
        <input
          className="guest-input"
          placeholder="Email adresa"
          type="email"
          style={{ marginTop: 8 }}
          value={localEmail}
          onChange={(e) => setLocalEmail(e.target.value)}
          onKeyDown={handleKey}
          disabled={isCreating} // Zaštita od duplog unosa tijekom trajanja mrežne transakcije
          aria-label="Email adresa"
        />
        <input
          className="guest-input"
          placeholder="Broj telefona (opcionalno)"
          type="tel"
          style={{ marginTop: 8 }}
          value={localPhone}
          onChange={(e) => setLocalPhone(e.target.value)}
          onKeyDown={handleKey}
          disabled={isCreating} // Onemogućeno dok klijentski fetch ne završi operaciju upisa
          aria-label="Broj telefona"
          maxLength={20} // Ograničenje dužine stringa radi sprječavanja prelijevanja u SQL bazi podataka
        />

        {/* ── Glavno dugme za potvrdu i slanje forme ────────────────────── */}
        <button
          // Klasa se dinamički mijenja u sivu (btn-disabled) ako obavezna polja nisu ispunjena
          className={`btn${localGuestName.trim() && localEmail.trim() && !isCreating ? ' btn-primary' : ' btn-disabled'}`}
          style={{ marginTop: 10, width: '100%' }}
          onClick={handleSubmit}
          // Hardverska blokada klika: gumb je fizički ugašen ako su polja prazna ili je slanje u tijeku
          disabled={!localGuestName.trim() || !localEmail.trim() || isCreating}
        >
          {isCreating ? 'Slanje...' : buttonText}
        </button>

        {/* ── Pod-komponenta za detaljan sezonski obračun cijena po danima ── */}
        <div
          className="price-preview-secure-container"
          style={{
            maxHeight: '140px', // Zaključavamo maksimalnu visinu na oko 4-5 redova dana
            overflowY: 'auto', // Ako raspon traje 30 dana, skroluje se isključivo unutar ovog malog okvira
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '8px',
            backgroundColor: '#f9fafb',
            marginTop: '4px',
          }}
        >
          <BookingPricePreview
            // Datume pretvaramo u ISOString standard kako bi zajednički algoritam imao fiksnu vremensku zonu
            startDateInput={selData.startDate.toISOString()}
            endDate={selData.endDate.toISOString()}
            rates={activeRates || []} // Siguran fallback u prazan niz kako pod-komponenta ne bi pukla
            bookingCapacity={localCapacity}
            // =============================================================================
            // UKLOPENI KOD: Kada pod-komponenta izračuna cenu unutar useMemo bloka,
            // mi je bezbjedno hvatamo i upisujemo u naš ref, spremnu za slanje u handleSubmit!
            // =============================================================================
            onPriceCalculated={(price) => {
              calculatedPriceRef.current = price;
            }}
          />
        </div>
      </div>
    </div>
  );
};
