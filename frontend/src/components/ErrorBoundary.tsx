import { Component, ErrorInfo, ReactNode } from 'react';
import { remoteLogger } from '../utils/remoteLogger';
import './ErrorBoundary.css'; // Opcioni CSS za izgled stranice sa greškom

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  // 1. Menja stanje komponente tako da sledeći render prikaže zamenski UI
  // ZAMENJENO: public static getDerivedStateFromError(_: Error) -> () State
  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  // 2. Mesto gde hvatamo detalje greške i šaljemo ih na naš backend preko Pina
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    remoteLogger({
      level: 'error',
      message: `Kritičan pad aplikacije: ${error.message}`,
      errorDetails: {
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      },
    });
  }

  public render() {
    if (this.state.hasError) {
      // Izgled ekrana koji korisnik vidi umesto prazne ili polomljene stranice
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-card">
            <h2>Uups! Nešto nije u redu. 🛠️</h2>
            <p>Došlo je do neočekivane greške u aplikaciji. Naš tim je obavešten.</p>
            <button className="error-boundary-button" onClick={() => (window.location.href = '/')}>
              Vrati se na početnu
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
