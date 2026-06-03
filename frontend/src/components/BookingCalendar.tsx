// =============================================================================
// 📅 frontend/src/components/BookingCalendar.tsx
// =============================================================================
//
// GLAVNA KOMPONENTA — Tanka orkestrator komponenta.
//
// Odgovornosti:
//   1. Inicijalizuje hook-ove (useCalendarLayout, useCalendarData, useDragDrop)
//   2. Sastavlja role-derived konstante (isAdmin, canEdit...)
//   3. Renderuje layout: Toolbar → Sidebar → Timeline
//   4. Prosleđuje podatke podkomponentama
//
// Sve poslovne logike, kalkulacije i side-effekti su u hook-ovima.
// Sve vizuelne celine su u podkomponentama.
//
// Arhitektura:
//   BookingCalendar (ovaj fajl — orkestrator)
//     ├── CalendarToolbar      → navigacija, statistike, login/logout
//     ├── CalendarSidebar      → lista apartmana
//     └── CalendarTimeline     → header + redovi
//           ├── TimelineHeader → datumi
//           └── TimelineRow    → ćelije + barovi + modal (po apartmanu)
// =============================================================================

import { useState, useMemo, useEffect, useCallback } from 'react';
import { addDays, eachDayOfInterval, startOfDay } from 'date-fns';
import './BookingCalendar.css';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../../../shared/index';

import type { SelectionState, DraggingState } from '../types/ui';

import { useCalendarData } from '../hooks/useCalendarData';
import { useCalendarLayout } from '../hooks/useCalendarLayout';
import { useDragDrop } from '../hooks/useDragDrop';
import { useSelectionData } from '../hooks/useSelectionData';
import { CalendarToolbar } from './calendar/CalendarToolbar';
import { CalendarSidebar } from './calendar/CalendarSidebar';
import { CalendarTimeline } from './calendar/CalendarTimeline';
import { BookingModal } from './BookingModal';

// =============================================================================
// 📐 LAYOUT KONSTANTE — Deljene sa podkomponentama
// =============================================================================

export const ROW_H = 52; // mora se poklapati sa CSS .row height
export const MODAL_W = 296;
export const MIN_DAY_W = 40;

// =============================================================================
// 🎛️  PROPS
// =============================================================================

interface BookingCalendarProps {
  currentUser: AuthUser | null;
  onLogout: () => void;
}

// =============================================================================
// 🗓️  KOMPONENTA
// =============================================================================

export default function BookingCalendar({ currentUser, onLogout }: BookingCalendarProps) {
  // ── Role-derived konstante ─────────────────────────────────────────────────
  const isAdmin = currentUser?.role === 'ADMIN';
  const isViewer = currentUser?.role === 'VIEWER';
  const isGuest = !currentUser;
  const canEdit = isAdmin;

  // ── Navigacija po datumima ─────────────────────────────────────────────────
  const [startDate, setStartDate] = useState<Date>(() => startOfDay(new Date()));

  // ── Layout (širina kontejnera, dayW, numDays) ──────────────────────────────
  const { timelineRef, dayW, numDays } = useCalendarLayout(MIN_DAY_W);

  // ── Niz vidljivih dana ─────────────────────────────────────────────────────
  const days = useMemo(
    () => eachDayOfInterval({ start: startDate, end: addDays(startDate, numDays - 1) }),
    [startDate, numDays],
  );

  // ── Selekcija ćelija ───────────────────────────────────────────────────────
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);

  // ── Podaci i CRUD akcije ───────────────────────────────────────────────────
  const {
    apartments,
    bookings,
    loading,
    error,
    createBooking,
    deleteBooking: rawDeleteBooking,
    updateBooking, // Uveri se da tvoj useCalendarData vraća updateBooking funkciju
    handleLogoutClick,
    bookingError,
    isCreating,
    isDeleting,
    bookingStyles,
    occupiedSet,
    stats,
  } = useCalendarData({
    days,
    dayW,
    startDate,
    setSelection: useCallback(() => setSelection(null), []), // Stabilna inline referenca
    isAdmin,
    canEdit,
    onLogout,
  });

  // ── Izvedeni selData (memoizovan) ──────────────────────────────────────────
  const selData = useSelectionData({ selection, days, dayW, apartments });

  const handleBookingUpdate = useCallback(
    async (bookingId: string, payload: { startDate: string; endDate: string }) => {
      if (updateBooking) {
        await updateBooking(bookingId, payload);
      }
    },
    [updateBooking],
  );

  const { dragging, dragValid, startDrag } = useDragDrop({
    canEdit,
    dayW,
    days,
    bookings,
    onBookingUpdate: handleBookingUpdate,
  });

  // ── Hover state (Stabilizovan pomoću useCallback-a za potrebe memo-a) ──────
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const deleteBooking = useCallback(
    async (id: string) => {
      await rawDeleteBooking(id);
    },
    [rawDeleteBooking],
  );

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection(null);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // ── Kreiramo adapter koji usklađuje startDrag sa potrebama CalendarTimeline ──
  const handleSetDragging = useCallback(
    (state: DraggingState | null) => {
      if (state === null) {
        // Ako timeline šalje null (kraj ili otkazivanje), čistimo interno stanje kuke
        // (useDragDrop unutar handleGlobalMouseUp već čisti stanje, ali ovo osigurava tipove)
        document.documentElement.style.removeProperty('--drag-offset-x');
      } else {
        // Ako stigne stvarni objekat, pokrećemo tvoj startDrag iz kuke
        startDrag(state);
      }
    },
    [startDrag],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading">Učitavanje kalendara...</div>;
  if (error) return <div className="error">Greška: {error}</div>;

  return (
    <div className="calendar" style={{ '--day-w': `${dayW}px` } as React.CSSProperties}>
      <CalendarToolbar
        startDate={startDate}
        setStartDate={setStartDate}
        stats={stats}
        currentUser={currentUser}
        isAdmin={isAdmin}
        isViewer={isViewer}
        canEdit={canEdit}
        onLogout={handleLogoutClick}
      />

      <div className="calendar-layout">
        <CalendarSidebar apartments={apartments} />

        <CalendarTimeline
          ref={timelineRef}
          days={days}
          startDate={startDate}
          apartments={apartments}
          bookings={bookings}
          bookingStyles={bookingStyles}
          occupiedSet={occupiedSet}
          dayW={dayW}
          selection={selection}
          setSelection={setSelection}
          isSelecting={isSelecting}
          setIsSelecting={setIsSelecting}
          dragging={dragging}
          setDragging={handleSetDragging}
          dragValid={dragValid}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          canEdit={canEdit}
          isGuest={isGuest}
          deleteBooking={deleteBooking} // 👈 Ovo ostaje jer trake u kalendaru moraju da se brišu!
          isDeleting={isDeleting} // 👈 Ovo ostaje za vizuelni efekat brisanja trake
          scrollLeft={scrollLeft}
          setScrollLeft={setScrollLeft}
        />
      </div>
      {/* 🚀 REACT PORTAL: Renderuje se samo JEDAN modal na nivou document.body */}
      {selData &&
        createPortal(
          <BookingModal
            showModal={selData !== null}
            selData={selData}
            setSelection={setSelection}
            createBooking={createBooking}
            apartmentsCount={apartments.length}
            aptIdx={apartments.findIndex((a) => a.id === selData?.aptId)} // Računamo indeks uživo na osnovu ID-ja apartmana
            dayW={dayW}
            modalW={MODAL_W}
            isAdmin={isAdmin}
            currentUser={currentUser}
            bookingError={bookingError}
            activeRates={apartments.find((a) => a.id === selData.aptId)?.rates || []}
            isCreating={isCreating}
          />,
          document.body, // 👈 Ubrizgava modal direktno na dno HTML-a van svih divova
        )}
    </div>
  );
}
