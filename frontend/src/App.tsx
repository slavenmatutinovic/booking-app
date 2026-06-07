// =============================================================================
// 🚀 frontend/src/App.tsx
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  KOREN APLIKACIJE — Upravljanje sesijom i rutiranjem                    │
// │                                                                         │
// │  Odgovornosti:                                                          │
// │   1. Provjera aktivne sesije pri prvom učitavanju (GET /api/auth/me)    │
// │   2. Određivanje korisničke role (ADMIN / VIEWER / gost bez login-a)    │
// │   3. Rutiranje između /calendar, /login i /* redirekcija                │
// │                                                                         │
// │  🔑 ROLE-BASED PRISTUP:                                                 │
// │   • /calendar je JAVNO — svako vidi popunjenost bez login-a             │
// │   • Role (ADMIN/VIEWER) se prenose niz stablu kao prop ili context      │
// │   • BookingCalendar sam odlučuje šta prikazuje na osnovu role           │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 TOK IZVRŠAVANJA PRI PRVOM UČITAVANJU:
//
//   Browser otvori /calendar
//        │
//        ▼
//   App se montira → isCheckingAuth = true → prikaži spinner
//        │
//        ▼
//   GET /api/auth/me
//        ├── 200 OK  → setUser({id, email, role})  → isCheckingAuth = false
//        ├── 401     → setUser(null) — gost vidi kalendar read-only
//        └── 5xx     → setUser(null) + log greške
//        │
//        ▼
//   Render sa tačnim state-om (bez flash-a login stranice)
//
// ⚠️  VAŽNA NAPOMENA O BEZBEDNOSTI:
//   Role provera na frontu je ISKLJUČIVO UX poboljšanje (sakrij/prikaži dugmad).
//   Pravi bezbednosni mehanizam su backend middleware-i requireAuth + requireAdmin.
//   Napadač koji zaobiđe front proveru dobija samo 403 od servera.
//
// =============================================================================

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import BookingCalendar from './components/BookingCalendar';
import { AdminDashboard } from './components/AdminDashboard';
import { useState, useEffect, JSX } from 'react';
import { getMe } from './api/auth';
import { remoteLogger } from './utils/remoteLogger';
import type { AuthUser } from '../../shared/index';
import { Toaster } from 'react-hot-toast';
import { AdminRatesPage } from './components/AdminRatesPage';

// =============================================================================
// 🛡️  ADMIN GUARD KOMPONENTA (Klijentski čuvar rute)
// =============================================================================
function RequireAdmin({ user, children }: { user: AuthUser | null; children: JSX.Element }) {
  // Ako korisnik nije ulogovan ili nije ADMIN, tiho ga vraćamo na javni kalendar
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/calendar" replace />;
  }
  return children;
}

// =============================================================================
// 🎛️  GLAVNA KOMPONENTA
// =============================================================================

function App() {
  // ---------------------------------------------------------------------------
  // 📌 STATE
  //
  // user     → null znači ili "nije ulogovan" ili "sesija istekla"
  //            Razliku ne pravimo na frontu — u oba slučaja vidi javni kalendar.
  //
  // isCheckingAuth → Sprečava "blesak" (flash) login stranice dok trajera provjera.
  //                  Bez ovog: korisnik bi vidio login formu na split-sekundu
  //                  pre nego što se sesija potvrdi iz HttpOnly kolačića.
  // ---------------------------------------------------------------------------

  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  // ---------------------------------------------------------------------------
  // 🔄 PROVJERA SESIJE PRI MONTIRAVANJU
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const checkSession = async () => {
      remoteLogger({ level: 'info', message: 'App mount — provjera sesije' });

      try {
        const data = await getMe();

        if (data?.user) {
          remoteLogger({
            level: 'info',
            message: 'Sesija obnovljena',
            errorDetails: { userId: data.user.id, role: data.user.role },
          });
          // ✅ Čuvamo kompletnog korisnika sa role — kalendar će znati šta da prikaže
          setUser({ id: data.user.id, email: data.user.email, role: data.user.role });
        } else {
          // 401 — nije ulogovan, ali to nije greška. Kalendar radi u read-only modu.
          remoteLogger({ level: 'info', message: 'Nema sesije — javni pregled kalendara' });
          setUser(null);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Nepoznata greška';
        remoteLogger({
          level: 'warn',
          message: 'Greška pri provjeri sesije',
          errorDetails: errMsg,
        });
        setUser(null);
      } finally {
        // KRITIČNO: Uvijek ugasi loading bez obzira na ishod
        setIsCheckingAuth(false);
      }
    };

    checkSession();
  }, []);

  // ---------------------------------------------------------------------------
  // ⏳ LOADING STANJE — Čekamo provjeru sesije
  // ---------------------------------------------------------------------------

  if (isCheckingAuth) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontSize: 16,
          color: '#6b7280',
          fontFamily: 'sans-serif',
        }}
      >
        Učitavanje...
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 🗺️  RUTIRANJE
  //
  //  /calendar → UVIJEK dostupno — gost vidi read-only, admin/viewer više
  //  /login    → Forma za prijavu; ako je već ulogovan preusmeri na /calendar
  //  /*        → Preusmeri na /calendar (ulogovan) ili /login (ne)
  //
  // 💡 ZAŠTO /calendar nije zaštićeno?
  //    Kalendar popunjenosti je korisna javna informacija (npr. za goste koji
  //    žele da vide slobodne termine). Samo upravljanje (drag, delete, create)
  //    je zaštićeno rolama unutar same BookingCalendar komponente.
  // ---------------------------------------------------------------------------

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        reverseOrder={false}
        toastOptions={{
          style: {
            fontFamily: 'sans-serif',
            fontSize: '14px',
            borderRadius: '8px',
            background: '#ffffff',
            color: '#1f2937',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#10b981',
              secondary: '#ffffff',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#ffffff',
            },
          },
        }}
      />
      <Routes>
        {/* 📅 Kalendar — JAVNO, ali ponašanje zavisi od role */}
        <Route
          path="/calendar"
          element={<BookingCalendar currentUser={user} onLogout={() => setUser(null)} />}
        />

        {/* 🔐 Login — preusmeri ako je već prijavljen */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/calendar" replace />
            ) : (
              <Login onLoginSuccess={(loggedUser) => setUser(loggedUser)} />
            )
          }
        />
        {/* 📬 🔒 ZAŠTIĆENA RUTA ZA UPRAVLJANJE ZAHTEVIMA GOSTIJU */}
        <Route
          path="/admin/requests"
          element={
            <RequireAdmin user={user}>
              <AdminDashboard />
            </RequireAdmin>
          }
        />

        {/* 💰 🔒 ZAŠTIĆENA RUTA ZA SEZONSKE CENOVNIKE I KAPACITETE */}
        <Route
          path="/admin/rates"
          element={
            <RequireAdmin user={user}>
              <AdminRatesPage />
            </RequireAdmin>
          }
        />

        {/* 🔀 Sve ostale putanje — preusmeri na odgovarajuće */}
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
