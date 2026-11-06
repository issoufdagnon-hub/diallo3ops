// database.js : structure de la base IndexedDB (aucun serveur, aucune connexion requise).
import { openDB } from 'idb';

export const NOM_BASE = 'diallo3ops';
// Toute modification de structure augmente ce numéro et ajoute une migration ici.
export const VERSION_BASE = 1;

export function openDatabase() {
  return openDB(NOM_BASE, VERSION_BASE, {
    upgrade(db) {
      // Journal financier : ajout seul.
      const mouvements = db.createObjectStore('mouvements', { keyPath: 'id' });
      mouvements.createIndex('operateur', 'operateur');
      mouvements.createIndex('referenceId', 'referenceId');
      mouvements.createIndex('dateHeure', 'dateHeure');

      // Vue des transferts (statut, motif, liens de remplacement).
      const transferts = db.createObjectStore('transferts', { keyPath: 'id' });
      transferts.createIndex('operateur', 'operateur');

      // Bénéficiaires connus (rempli dans l'étape des écrans).
      const beneficiaires = db.createObjectStore('beneficiaires', { keyPath: 'id' });
      beneficiaires.createIndex('operateurNumero', ['operateur', 'numero'], { unique: true });

      // Registre anti-doublon : une clé d'opération ne peut être enregistrée qu'une fois.
      db.createObjectStore('operations', { keyPath: 'cleIdempotence' });

      // Journal d'audit : ajout seul.
      const audit = db.createObjectStore('journal_audit', { keyPath: 'id' });
      audit.createIndex('dateHeure', 'dateHeure');

      db.createObjectStore('parametres', { keyPath: 'cle' });
    },
  });
}
