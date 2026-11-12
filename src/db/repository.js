// repository.js : accès IndexedDB.
// Chaque opération = UNE transaction : lecture du solde, contrôle des règles, écriture.
// Deux opérations sur le même opérateur ne peuvent donc pas se chevaucher.
import { openDatabase } from './database.js';
import * as ledger from '../domain/ledger.js';

let dbPromise = null;
const getDb = () => (dbPromise ??= openDatabase());

export const nouvelleCle = () => crypto.randomUUID();

async function executer({ cle, operateur, type, planifier }) {
  if (!cle) throw new Error('Clé d’idempotence manquante.');
  const db = await getDb();
  const tx = db.transaction(['mouvements', 'transferts', 'operations', 'journal_audit'], 'readwrite');
  try {
    // Anti-doublon : si l'opération existe déjà, on renvoie le résultat d'origine sans rien écrire.
    const dejaFaite = await tx.objectStore('operations').get(cle);
    if (dejaFaite) {
      await tx.done;
      return { ...dejaFaite.resultat, duplicat: true };
    }

    const mouvements = await tx.objectStore('mouvements').index('operateur').getAll(operateur);
    const transferts = await tx.objectStore('transferts').index('operateur').getAll(operateur);
    const plan = planifier({
      mouvements,
      transferts,
      ctx: { nouvelId: () => crypto.randomUUID(), maintenant: new Date().toISOString(), operationId: cle },
    });

    for (const m of plan.mouvements) await tx.objectStore('mouvements').add(m);
    for (const t of plan.transfertsAjout) await tx.objectStore('transferts').add(t);
    for (const t of plan.transfertsMaj) await tx.objectStore('transferts').put(t);
    for (const a of plan.audit) await tx.objectStore('journal_audit').add(a);
    await tx.objectStore('operations').add({
      cleIdempotence: cle,
      type,
      operateur,
      dateHeure: new Date().toISOString(),
      resultat: plan.resultat,
    });
    await tx.done;
    return { ...plan.resultat, duplicat: false };
  } catch (err) {
    try { tx.abort(); } catch { /* transaction déjà terminée */ }
    throw err;
  }
}

async function operateurDuTransfert(transfertId) {
  const db = await getDb();
  const transfert = await db.get('transferts', transfertId);
  if (!transfert) throw new ledger.RegleMetierError('Transfert introuvable.');
  return transfert.operateur;
}

// ---------- Opérations ----------

export const enregistrerSoldeInitial = ({ operateur, montant, cle }) =>
  executer({ cle, operateur, type: 'SOLDE_INITIAL',
    planifier: (d) => ledger.planifierSoldeInitial({ ...d, operateur, montant }) });

export const enregistrerRecharge = ({ operateur, montant, cle }) =>
  executer({ cle, operateur, type: 'RECHARGEMENT',
    planifier: (d) => ledger.planifierRecharge({ ...d, operateur, montant }) });

export const creerTransfert = ({ operateur, montant, beneficiaire, statutPaiement, cle }) =>
  executer({ cle, operateur, type: 'TRANSFERT',
    planifier: (d) => ledger.planifierTransfert({ ...d, operateur, montant, beneficiaire, statutPaiement }) });

export async function annulerTransfert({ transfertId, motif, cle }) {
  const operateur = await operateurDuTransfert(transfertId);
  return executer({ cle, operateur, type: 'ANNULATION',
    planifier: (d) => ledger.planifierAnnulation({ ...d, transfertId, motif }) });
}

export async function modifierTransfert({ transfertId, champs, motif, cle }) {
  const operateur = await operateurDuTransfert(transfertId);
  return executer({ cle, operateur, type: 'MODIFICATION',
    planifier: (d) => ledger.planifierModification({ ...d, transfertId, champs, motif }) });
}

export const modifierRecharge = ({ operateur, mouvementId, nouveauMontant, motif, cle }) =>
  executer({ cle, operateur, type: 'MODIFICATION_RECHARGE',
    planifier: (d) => ledger.planifierModificationRecharge({ ...d, mouvementId, nouveauMontant, motif }) });

export async function changerStatutPaiement({ transfertId, statutPaiement, cle }) {
  const operateur = await operateurDuTransfert(transfertId);
  return executer({ cle, operateur, type: 'PAIEMENT',
    planifier: (d) => ledger.planifierChangementPaiement({ ...d, transfertId, statutPaiement }) });
}

// ---------- Lectures ----------

export async function soldeOperateur(operateur) {
  const db = await getDb();
  const mouvements = await db.getAllFromIndex('mouvements', 'operateur', operateur);
  return ledger.soldeOperateur(mouvements, operateur);
}

export async function lireMouvements(operateur) {
  const db = await getDb();
  return db.getAllFromIndex('mouvements', 'operateur', operateur);
}

export async function lireTransferts(operateur) {
  const db = await getDb();
  return db.getAllFromIndex('transferts', 'operateur', operateur);
}

export async function lireJournal() {
  const db = await getDb();
  return db.getAll('journal_audit');
}

export async function verifierIntegriteBase() {
  const db = await getDb();
  const [mouvements, transferts] = await Promise.all([db.getAll('mouvements'), db.getAll('transferts')]);
  return ledger.verifierIntegrite({ mouvements, transferts });
}

// Demande au navigateur de ne pas effacer les données quand le stockage est plein.
export async function demanderStockagePersistant() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
