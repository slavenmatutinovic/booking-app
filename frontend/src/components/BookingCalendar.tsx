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

import { useState, useMemo, useEffect, useRef } from 'react';
import { addDays, eachDayOfInterval, startOfDay } from 'date-fns';
import './BookingCalendar.css';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../../../shared/index';
import type { SelectionState } from '../types/ui';
import type { FrontendBooking } from '../types/ui';

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
    setBookings,
    createBooking,
    deleteBooking,
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
    setSelection: () => setSelection(null),
    isAdmin,
    canEdit,
    onLogout,
  });

  // ── Izvedeni selData (memoizovan) ──────────────────────────────────────────
  const selData = useSelectionData({ selection, days, dayW, apartments });

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const { dragging, setDragging, dragValid } = useDragDrop({
    bookings,
    setBookings,
    canEdit,
    dayW,
  });

  // ── Hover state (za tooltip i X dugme) ────────────────────────────────────
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const bookingsRef = useRef<FrontendBooking[]>(bookings);
  useEffect(() => {
    bookingsRef.current = bookings;
  }, [bookings]);

  // ── Globalni keyboard/mouse handleri ──────────────────────────────────────
  useEffect(() => {
    const onUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection(null);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

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
          setDragging={setDragging}
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
            daysCount={days.length}
            dayW={dayW}
            rowH={ROW_H}
            modalW={MODAL_W}
            isAdmin={isAdmin}
            currentUser={currentUser}
            bookingError={bookingError}
            scrollLeft={scrollLeft}
            isCreating={isCreating}
            isDeleting={isDeleting}
          />,
          document.body, // 👈 Ubrizgava modal direktno na dno HTML-a van svih divova
        )}
    </div>
  );
}
