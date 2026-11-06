// pinRepository.js : stockage du PIN et du compteur d'échecs dans IndexedDB (magasin "parametres").
import { openDatabase } from './database.js';

let dbPromise = null;
const getDb = () => (dbPromise ??= openDatabase());

export async function lirePinEtTentatives() {
  const db = await getDb();
  const [pin, tentatives] = await Promise.all([
    db.get('parametres', 'pin'),
    db.get('parametres', 'tentatives'),
  ]);
  return {
    empreinte: pin ? { sel: pin.sel, hash: pin.hash, iterations: pin.iterations } : null,
    tentatives: tentatives ?? { echecs: 0, dernierEchec: 0 },
  };
}

export async function definirPin(empreinte) {
  const db = await getDb();
  await db.put('parametres', { cle: 'pin', ...empreinte });
  await db.put('parametres', { cle: 'tentatives', echecs: 0, dernierEchec: 0 });
}

// Enregistre un échec et le journalise dans la même transaction.
export async function enregistrerEchecPin(maintenantMs) {
  const db = await getDb();
  const tx = db.transaction(['parametres', 'journal_audit'], 'readwrite');
  const actuel = (await tx.objectStore('parametres').get('tentatives')) ?? { echecs: 0, dernierEchec: 0 };
  const nouveau = { cle: 'tentatives', echecs: actuel.echecs + 1, dernierEchec: maintenantMs };
  await tx.objectStore('parametres').put(nouveau);
  await tx.objectStore('journal_audit').add({
    id: crypto.randomUUID(),
    dateHeure: new Date(maintenantMs).toISOString(),
    action: 'ECHEC_PIN',
    entite: 'parametre',
    entiteId: 'pin',
    avant: { echecs: actuel.echecs },
    apres: { echecs: nouveau.echecs },
    motif: null,
    operationId: null,
  });
  await tx.done;
  return nouveau;
}

export async function reinitialiserEchecsPin() {
  const db = await getDb();
  await db.put('parametres', { cle: 'tentatives', echecs: 0, dernierEchec: 0 });
}
