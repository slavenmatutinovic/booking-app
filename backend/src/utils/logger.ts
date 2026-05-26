import pino from 'pino';
import { env } from '../config/env'; // Uvezite vaš verifikovani env sa Zod-om

// 1. Kreiramo bazičnu konfiguraciju
const config: pino.LoggerOptions = {
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
};

// 2. Dinamički dodajemo transport SAMO u developmentu
// Ovo sprečava pojavu 'undefined' vrednosti i ujedno rešava slanje u lokalni fajl
if (env.NODE_ENV === 'development') {
  config.transport = {
    target: 'pino/file',
    options: {
      // Lokacija gde će se na vašem računaru kreirati log fajl (u korenu projekta)
      destination: './aplikacija.log',
      mkdir: true,
    },
  };
}

// 3. Inicijalizujemo loger sa čistim objektom
export const logger = pino(config);
