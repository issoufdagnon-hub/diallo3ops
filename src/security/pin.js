// pin.js : code PIN à 4 chiffres, haché avec PBKDF2-SHA256 (Web Crypto). Jamais stocké en clair.
// Logique pure et testable : aucune dépendance à IndexedDB.

export const PIN_LONGUEUR = 4;
export const ITERATIONS_PBKDF2 = 310000;

const encodeur = new TextEncoder();

export function formatPinValide(pin) {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LONGUEUR}}$`).test(pin);
}

async function deriver(pin, sel, iterations) {
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' },
    cle,
    256,
  );
  return new Uint8Array(bits);
}

// Renvoie { sel, hash, iterations } à enregistrer. Le sel est aléatoire et propre à chaque PIN.
export async function creerEmpreintePin(pin, iterations = ITERATIONS_PBKDF2) {
  if (!formatPinValide(pin)) throw new Error('Le PIN doit comporter 4 chiffres.');
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriver(pin, sel, iterations);
  return { sel, hash, iterations };
}

// Comparaison à temps constant pour ne pas révéler d'information par la durée du calcul.
export async function verifierPin(pin, empreinte) {
  if (!formatPinValide(pin)) return false;
  const essai = await deriver(pin, empreinte.sel, empreinte.iterations);
  if (essai.length !== empreinte.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < essai.length; i++) diff |= essai[i] ^ empreinte.hash[i];
  return diff === 0;
}

// Politique de tentatives :
//   0 à 2 échecs : pas d'attente
//   3 et 4 échecs : attente de 30 secondes
//   5 à 9 échecs : attente de 5 minutes
//   10 échecs ou plus : restauration d'une sauvegarde obligatoire
export function politiqueEchecs(echecs) {
  if (echecs >= 10) return { restaurationRequise: true, attenteMs: Infinity };
  if (echecs >= 5) return { restaurationRequise: false, attenteMs: 5 * 60_000 };
  if (echecs >= 3) return { restaurationRequise: false, attenteMs: 30_000 };
  return { restaurationRequise: false, attenteMs: 0 };
}

// Renvoie les millisecondes restantes avant le prochain essai (0 = essai autorisé).
export function attenteRestante({ echecs, dernierEchec }, maintenantMs) {
  const { attenteMs } = politiqueEchecs(echecs);
  if (attenteMs === 0) return 0;
  if (attenteMs === Infinity) return Infinity;
  return Math.max(0, dernierEchec + attenteMs - maintenantMs);
}
