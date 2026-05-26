// Login.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // 1. UVOZ KUKE ZA NAVIGACIJU
import './Login.css'; // 🚀 Uvozimo eksterni CSS fajl koji smo upravo kreirali
import { loginUser } from '../api/auth'; // Koristiti postojeću funkciju
import { remoteLogger } from '../utils/remoteLogger';
import type { AuthUser } from '../types';

interface LoginProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const navigate = useNavigate();
  // --- STATE (STANJA) KOMPONENTE ---

  // Prate tekst koji korisnik kuca u realnom vremenu
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Čuva tekstualnu poruku o grešci sa backenda (inicijalno je null jer greške nema)
  const [error, setError] = useState<string | null>(null);

  // Prati da li je zahtev trenutno na serveru (zaustavlja duple klikove na dugme)
  const [loading, setLoading] = useState(false);

  // --- FUNKCIJA ZA SLANJE PODATAKA (SUBMIT HANDLER) ---
  // Izvršava se kada korisnik klikne na dugme ili pritisne Enter unutar forme
  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault(); // 1. Zaustavlja osvežavanje stranice (podrazumevano ponašanje HTML forme)
    setError(null); // 2. Resetuje prethodnu grešku pre novog pokušaja prijave
    setLoading(true); // 3. Aktivira loading stanje (blokira dugme)

    try {
      const data = await loginUser(email, password); // Umesto direktnog apiFetch
      console.log('Uspešna prijava:', data.user);
      remoteLogger({
        level: 'info',
        message: 'Uspešan pokušaj prijave na sistem',
        errorDetails: { email, userId: data.user.id, role: data.user.role },
      });
      // ✅ 3. PROSLEĐUJEMO KORISNIKA U STATE RODITELJSKE (App.tsx) KOMPONENTE
      onLoginSuccess({ id: data.user.id, email: data.user.email, role: data.user.role });
      navigate('/calendar'); // sa React Router
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Greška pri povezivanju';
      setError(errorMsg); // 4. Postavlja poruku o grešci u state, što će pokrenuti re-render i prikaz crvene kutije
      remoteLogger({
        level: 'error',
        message: 'Neuspešan pokušaj prijave na sistem',
        errorDetails: { email, originalError: errorMsg },
      });
    } finally {
      setLoading(false);
    }
  };

  // --- RENDER LOGIKA (HTML STABLO) ---
  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">Prijava na sistem</h2>

        {/* USLOVNO RENDEROWANJE: Prikazuje crvenu kutiju samo ako držimo grešku u state-u */}
        {error && <div className="login-error-box">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Polje za Imejl */}
          <div className="login-input-group">
            <label className="login-label">Imejl adresa:</label>
            <input
              type="email"
              value={email}
              // Dvosmerno vezivanje (Two-way binding): čim korisnik ukuca slovo, ažurira se stanje
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="unesite@email.com"
              className="login-input"
            />
          </div>

          {/* Polje za Lozinku */}
          <div className="login-input-group">
            <label className="login-label">Lozinka:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="login-input"
            />
          </div>

          {/* Dugme za prijavu */}
          {/* Ako je loading=true, dugme dobija HTML atribut 'disabled' i menja stil u sivo */}
          <button type="submit" disabled={loading} className="login-button">
            {loading ? 'Provera podataka...' : 'Prijavi se'}
          </button>
        </form>
      </div>
    </div>
  );
}
