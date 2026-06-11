// =============================================================================
// 💬 frontend/src/components/BookingModal.tsx
// =============================================================================

import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import type { AuthUser, ApartmentRateData } from '../../../shared/index';
import type { SelData } from '../types/ui';
import { fmtShort } from '../utils/dates';
import { BookingPricePreview } from './BookingPricePreview';

interface BookingModalProps {
  showModal: boolean;
  selData: SelData | null;
  setSelection: (val: null) => void;
  createBooking: (
    formData: {
      guestName: string;
      email: string;
      phone: string;
      capacity: number;
    },
    selData: SelData | null,
  ) => void | Promise<void>;
  apartmentsCount: number;
  aptIdx: number;
  dayW: number;
  modalW: number;
  isCreating: boolean;
  isAdmin: boolean;
  currentUser: AuthUser | null;
  bookingError: string | null;
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
  // 🆕 DOHVATANJE DOSTUPNIH KAPACITETA IZ BAZE:
  // Skeniramo activeRates niz, izvlačimo jedinstvene kapacitete i sortiramo ih hronološki
  const availableCapacities: number[] = useMemo(() => {
    if (!activeRates || activeRates.length === 0) {
      return [2]; // Bezbedan fallback ako apartman nema upisane stope
    }

    // Izvlačimo sve capacity vrednosti iz objekata
    const rawCapacities = activeRates.map((rate) => Number(rate.capacity));

    // Koristimo Set da zadržimo samo jedinstvene brojeve (npr. [2, 3, 4])
    const uniqueSet = new Set<number>(rawCapacities);

    // Pretvaramo nazad u čist niz i sortiramo od najmanjeg ka najvećem
    return Array.from(uniqueSet).sort((a, b) => a - b);
  }, [activeRates]);

  // ✅ Lokalizovana stanja forme
  const [localGuestName, setLocalGuestName] = useState('');
  const [localEmail, setLocalEmail] = useState('');
  const [localPhone, setLocalPhone] = useState('');
  // 🆕 AUTOMATSKO POSTAVLJANJE PRVE OPCIJE:
  // Kada admin promeni apartman, automatski postavljamo najmanji dostupni kapacitet iz baze kao selektovan
  const [localCapacity, setLocalCapacity] = useState<number>(() => {
    return availableCapacities[0] ?? 2;
  });
  // ✅ Lokalno stanje za žive koordinate na ekranu
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const localGuestRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selData?.aptId && availableCapacities.length > 0) {
      const nextDefaultOption = availableCapacities[0] ?? 2;

      Promise.resolve().then(() => {
        setLocalCapacity(nextDefaultOption);
      });
    }
  }, [selData?.aptId, availableCapacities]);

  // ✅ Fokus se postavlja asinhrono i bezbedno — NEMA setState poziva ovde!
  useEffect(() => {
    if (!showModal) return;

    const timer = setTimeout(() => {
      localGuestRef.current?.focus();
    }, 60);

    // Vraćamo cleanup funkciju koja sprečava memory leak
    return () => clearTimeout(timer);
  }, [showModal]);

  // ✅ 2. 🚀 PORTAL LIVE POS PRORAČUN: Računamo koordinate uživo iz DOM-a
  useLayoutEffect(() => {
    if (!showModal || !selData) return;

    const activeSelData = selData;
    function updatePosition() {
      // Pronalazimo sve redove na kalendaru (.row)
      const rowElements = document.querySelectorAll('.row');
      const targetRow = rowElements[activeSelData.aptIdx];

      if (targetRow) {
        // Uzimamo žive koordinate tog reda u odnosu na vidljivi prozor (viewport)
        const rect = targetRow.getBoundingClientRect();
        const rowHeight = rect.height;

        // Računamo horizontalnu (left) poziciju modala
        const targetLeft = Math.min(
          Math.max(rect.left + activeSelData.left - (modalW + 2 * dayW), 16),
          window.innerWidth - modalW - 16,
        );

        // Računamo vertikalnu (top) poziciju modala (ispod reda)
        const targetTop = rect.top + rowHeight + 6;
        console.log('BookingModal: Pronalazim ciljnu .row za pozicioniranje modala...', {
          activeSelData,
          rowCount: rowElements.length,
          targetRow,
        });
        console.log('BookingModal: Ciljna .row koordinate (relative to viewport)', {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        // Ako modal bije blizu dna ekrana, automatski ga "skačemo" IZNAD reda (300px procena visine modala)
        const adjustedTop = targetTop + 300 > window.innerHeight ? rect.top - 300 - 6 : targetTop;

        setCoords({ top: adjustedTop, left: targetLeft });
        console.log('BookingModal: Postavljam modal na koordinate', {
          top: adjustedTop,
          left: targetLeft,
        });
      }
    }

    // Izvršavamo odmah pri otvaranju
    updatePosition();

    // Slušamo promenu veličine prozora ako korisnik rasteže brauzer
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [showModal, selData, modalW, dayW]);

  if (!showModal || !selData) return null;

  // ── Role-specific tekst ───────────────────────────────────────────────────
  const modalTitle = isAdmin ? 'Nova rezervacija' : 'Zahtev za rezervaciju';
  const buttonText = isAdmin ? 'Kreiraj rezervaciju' : 'Pošalji zahtev';
  const guestLabel = currentUser ? 'Ime gosta' : 'Vaše ime';

  // Eksplicitna funkcija za zatvaranje koja čisti stanje forme
  const handleClose = () => {
    const defaultCapacity =
      availableCapacities && availableCapacities.length > 0 ? Number(availableCapacities[0]) : 1;
    // Clear inputs and sync state uniformly using the true apartment bounds
    setLocalCapacity(defaultCapacity);
    setSelection(null);
    setLocalGuestName('');
    setLocalEmail('');
    setLocalPhone('');
  };

  const handleSubmit = async () => {
    if (!localGuestName.trim() || !localEmail.trim() || isCreating) return;

    await createBooking(
      {
        guestName: localGuestName.trim(),
        email: localEmail.trim(),
        phone: localPhone.trim(),
        capacity: localCapacity,
      },
      selData,
    );

    if (bookingError) {
      console.warn('Slom validacije, forma se ne prazni:', bookingError);
      return;
    }

    // Čistimo formu nakon uspešnog kreiranja
    const defaultCapacity =
      availableCapacities && availableCapacities.length > 0 ? Number(availableCapacities[0]) : 1;

    setLocalCapacity(defaultCapacity);
    setLocalGuestName('');
    setLocalEmail('');
    setLocalPhone('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  // 🛡️ RAČUNAMO PREOSTALI PROSTOR DO DNA EKRANA (100vh - coords.top - sigurna margina za dugme)
  const dynamicMaxCardHeight = coords.top > 0 ? `calc(100vh - ${coords.top}px - 25px)` : '85vh';

  return (
    <div
      className="modal"
      style={{
        position: 'fixed', // 👈 Ostaje fixed jer ide preko Portala u body
        left: `${coords.left}px`, // 👈 Eksplicitno dodajemo 'px' za striktan CSS standard
        top: `${coords.top}px`, // 👈 Eksplicitno dodajemo 'px' za striktan CSS standard
        zIndex: 99999, // Najviši sloj na ekranu
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="modal-card"
        style={{
          maxHeight: dynamicMaxCardHeight,
          position: 'relative',
          paddingBottom: '65px', // 🔒 KLJUČ: Pravimo prazan prostor na dnu u koji fiksiramo dugme!
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'block', // Radimo u standardnom block režimu da zaobiđemo CSS klase
        }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="modal-header">
          <div>
            <div className="modal-title">{modalTitle}</div>
            <div className="modal-subtitle">
              {fmtShort(selData.startDate)} {' → '} {fmtShort(selData.endDate)}
              {' · '}
              {selData.totalDays} {selData.totalDays === 1 ? 'dan' : 'dana'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Broj kreveta (Kapacitet)
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
              {/* ✅ REŠENJE: Iscrtavamo isključivo opcije koje stvarno postoje za ovaj apartman u SQL bazi */}
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

        {/* ── Error poruka ─────────────────────────────────────────── */}
        {bookingError && <div className="modal-notice modal-notice--error">⚠️ {bookingError}</div>}

        {/* ── Napomene po roli ─────────────────────────────────────── */}
        {!currentUser && (
          <div className="modal-notice modal-notice--info">💡 Vaš zahtev će biti proslijeđen.</div>
        )}
        {currentUser && !isAdmin && (
          <div className="modal-notice modal-notice--viewer">
            📬 Vaš zahtev će biti proslijeđen adminu na odobrenje.
          </div>
        )}

        {/* ── Forma ────────────────────────────────────────────────── */}
        <input
          ref={localGuestRef}
          className="guest-input"
          placeholder={guestLabel}
          value={localGuestName}
          onChange={(e) => setLocalGuestName(e.target.value)}
          onKeyDown={handleKey}
          disabled={isCreating}
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
          disabled={isCreating}
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
          disabled={isCreating}
          aria-label="Broj telefona"
          maxLength={20}
        />

        {/* ── Submit dugme ─────────────────────────────────────────── */}
        <button
          className={`btn${localGuestName.trim() && localEmail.trim() && !isCreating ? ' btn-primary' : ' btn-disabled'}`}
          style={{ marginTop: 10, width: '100%' }}
          onClick={handleSubmit}
          disabled={!localGuestName.trim() || !localEmail.trim() || isCreating}
        >
          {isCreating ? 'Slanje...' : buttonText}
        </button>

        {/* ============================================================================= */}
        {/* 🧮 DINO-OBRAČUN PREDAJA: Dinamički pregled cena po danima i sezonama        */}
        {/* ============================================================================= */}
        <div
          className="price-preview-secure-container"
          style={{
            maxHeight: '140px', // 🔒 Zaključavamo visinu detaljnog obračuna (npr. oko 4-5 redova dana)
            overflowY: 'auto', // Ako ima 20 dana, skroluje se isključivo unutar ovog malog boksa!
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '8px',
            backgroundColor: '#f9fafb',
            marginTop: '4px',
          }}
        >
          <BookingPricePreview
            startDateInput={selData.startDate.toISOString()} // Prosleđujemo selektovani početak
            endDate={selData.endDate.toISOString()} // Prosleđujemo selektovani kraj
            rates={activeRates || []} // Niz sezonskih cena prosleđen sa kalendara/apartmana
            bookingCapacity={localCapacity}
          />
        </div>
      </div>
    </div>
  );
};
