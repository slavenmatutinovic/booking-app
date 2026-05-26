import apiFetch from './index';
import { remoteLogger } from '../utils/remoteLogger';

// Definišemo TypeScript interfejs za podatke koje funkcija vraća
interface LoginResponse {
  message: string;
  user: {
    id: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
  };
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
    createdAt: string;
  };
}

export const loginUser = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await apiFetch('auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    // Ako server vrati npr. 401, bacamo grešku sa porukom sa backenda
    throw new Error(data.error || 'Greška pri prijavi');
  }

  return data;
};

// Vrača null ako sesija ne postoji (401) — nije greška, korisnik nije ulogovan
export const getMe = async (): Promise<MeResponse | null> => {
  const response = await apiFetch('auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Greška pri proveri sesije');
  return response.json();
};

export const logoutUser = async (): Promise<boolean> => {
  try {
    // Koristimo vaš apiFetch (on već automatski dodaje credentials: 'include')
    const response = await apiFetch('auth/logout', { method: 'POST' });

    // Vraćamo true samo ako je server vratio status 200-299
    return response.ok;
  } catch (error) {
    remoteLogger({ level: 'error', message: 'Greška prilikom odjave', errorDetails: error });
    return false;
  }
};
