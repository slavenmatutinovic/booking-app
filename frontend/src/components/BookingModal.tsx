// =============================================================================
// 💬 frontend/src/components/BookingModal.tsx
// =============================================================================

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
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
}) => {
  // ✅ Lokalizovana stanja forme
  const [localGuestName, setLocalGuestName] = useState('');
  const [localEmail, setLocalEmail] = useState('');
  const [localPhone, setLocalPhone] = useState('');
  const localGuestRef = useRef<HTMLInputElement>(null);

  // ✅ Lokalno stanje za žive koordinate na ekranu
  const [coords, setCoords] = useState({ top: 0, left: 0 });

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
          Math.max(rect.left + activeSelData.left + activeSelData.width / 2 - modalW / 2, 16),
          window.innerWidth - modalW - 16,
        );

        // Računamo vertikalnu (top) poziciju modala (ispod reda)
        const targetTop = rect.top + rowHeight + 6;

        // Ako modal bije blizu dna ekrana, automatski ga "skačemo" IZNAD reda (300px procena visine modala)
        const adjustedTop = targetTop + 300 > window.innerHeight ? rect.top - 300 - 6 : targetTop;

        setCoords({ top: adjustedTop, left: targetLeft });
      }
    }

    // Izvršavamo odmah pri otvaranju
    updatePosition();

    // Slušamo promenu veličine prozora ako korisnik rasteže brauzer
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [showModal, selData, modalW]);

  if (!showModal || !selData) return null;

  // ── Role-specific tekst ───────────────────────────────────────────────────
  const modalTitle = isAdmin ? 'Nova rezervacija' : 'Zahtev za rezervaciju';
  const buttonText = isAdmin ? 'Kreiraj rezervaciju' : 'Pošalji zahtev';
  const guestLabel = currentUser ? 'Ime gosta' : 'Vaše ime';

  // Eksplicitna funkcija za zatvaranje koja čisti stanje forme
  const handleClose = () => {
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
      },
      selData,
    );

    // Čistimo formu nakon uspešnog kreiranja
    setLocalGuestName('');
    setLocalEmail('');
    setLocalPhone('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

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
      <div className="modal-card">
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
          <button className="modal-close" onClick={handleClose} aria-label="Zatvori modal">
            ×
          </button>
        </div>

        {/* ── Error poruka ─────────────────────────────────────────── */}
        {bookingError && <div className="modal-notice modal-notice--error">⚠️ {bookingError}</div>}

        {/* ── Napomene po roli ─────────────────────────────────────── */}
        {!currentUser && (
          <div className="modal-notice modal-notice--info">
            💡 Prijavite se kao admin za direktno kreiranje rezervacija. Vaš zahtev će biti
            proslijeđen na odobrenje.
          </div>
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

        {/* ============================================================================= */}
        {/* 🧮 DINO-OBRAČUN PREDAJA: Dinamički pregled cena po danima i sezonama        */}
        {/* ============================================================================= */}
        <BookingPricePreview
          startDate={selData.startDate.toISOString()} // Prosleđujemo selektovani početak
          endDate={selData.endDate.toISOString()} // Prosleđujemo selektovani kraj
          activeRates={activeRates || []} // Niz sezonskih cena prosleđen sa kalendara/apartmana
          defaultPrice={50.0} // Fallback cena ako dan ne upada ni u jednu sezonu
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
      </div>
    </div>
  );
};
