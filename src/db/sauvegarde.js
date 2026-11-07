// sauvegarde.js : sauvegarde, rappel, vérification et restauration (IndexedDB).
import { openDatabase } from './database.js';
import * as ledger from '../domain/ledger.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const APPLICATION = 'DIALLO3OPS';
export const FORMAT = 2;
const FORMATS_LISIBLES = [2];
const MAGASINS = ['mouvements', 'transferts', 'operations', 'journal_audit'];
const JOURS_RAPPEL = 7;
const OPS_RAPPEL = 50;
const enc = new TextEncoder();

export async function sha256Hex(texte) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(texte));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function journaliser(trace) {
  const db = await openDatabase();
  await db.add('journal_audit', { id: crypto.randomUUID(), dateHeure: new Date().toISOString(), operationId: null, motif: null, avant: null, apres: null, ...trace });
}

export async function construireSauvegarde() {
  const db = await openDatabase();
  const [mouvements, transferts, operations, journal] = await Promise.all(MAGASINS.map((m) => db.getAll(m)));
  const contenu = JSON.stringify({ mouvements, transferts, operations, journal });
  const date = new Date().toISOString();
  return {
    application: APPLICATION, format: FORMAT, date,
    nombreEntrees: journal.length, nombreMouvements: mouvements.length,
    contenu, empreinte: await sha256Hex(contenu),
  };
}

// Sur Android (APK) : écriture dans le cache puis fenêtre de partage native.
// Dans le navigateur (PWA) : partage web si possible, sinon téléchargement.
export async function produireFichier(prefixe) {
  const s = await construireSauvegarde();
  const contenuFichier = JSON.stringify(s);
  const nom = `DIALLO3OPS_${prefixe}_${s.date.slice(0, 10)}_${s.date.slice(11, 13)}h${s.date.slice(14, 16)}.json`;

  if (Capacitor.isNativePlatform()) {
    const ecrit = await Filesystem.writeFile({
      path: nom, data: contenuFichier, directory: Directory.Cache, encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: 'Sauvegarde DIALLO 3 OPÉRATEURS', url: ecrit.uri, dialogTitle: 'Enregistrer la sauvegarde' });
    } catch {
      return null;
    }
    return s;
  }

  const blob = new Blob([contenuFichier], { type: 'application/json' });
  const fichier = new File([blob], nom, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: 'Sauvegarde DIALLO 3 OPÉRATEURS' });
    } catch (e) {
      if (e.name === 'AbortError') return null;
      telechargerAncre(blob, nom);
    }
  } else {
    telechargerAncre(blob, nom);
  }
  return s;
}

function telechargerAncre(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function sauvegarderManuellement() {
  const s = await produireFichier('MANUEL');
  if (!s) return false;
  const db = await openDatabase();
  await db.put('parametres', { cle: 'derniereSauvegarde', date: s.date, nombre: s.nombreMouvements });
  await journaliser({ action: 'SAUVEGARDE', entite: 'parametre', entiteId: 'sauvegarde', apres: { nombreMouvements: s.nombreMouvements } });
  return true;
}

export async function rappelSauvegarde() {
  const db = await openDatabase();
  const d = await db.get('parametres', 'derniereSauvegarde');
  if (!d) return 'Aucune sauvegarde n’a encore été faite. Faites-en une dès maintenant.';
  const jours = (Date.now() - Date.parse(d.date)) / 86400000;
  const mouvements = await db.getAll('mouvements');
  const ops = mouvements.filter((m) => m.dateHeure > d.date).length;
  if (jours >= JOURS_RAPPEL || ops >= OPS_RAPPEL) {
    return `Pensez à sauvegarder : dernière sauvegarde il y a ${Math.floor(jours)} jour(s), ${ops} opération(s) depuis.`;
  }
  return '';
}

export async function verifierFichier(texte) {
  let s;
  try { s = JSON.parse(texte); } catch { throw new Error('Fichier illisible : ce n’est pas une sauvegarde valide.'); }
  if (s.application !== APPLICATION || !FORMATS_LISIBLES.includes(s.format)) throw new Error('Ce fichier ne correspond pas à cette application.');
  if (typeof s.contenu !== 'string' || typeof s.empreinte !== 'string') throw new Error('Structure de la sauvegarde incorrecte.');
  if ((await sha256Hex(s.contenu)) !== s.empreinte) throw new Error('Fichier altéré ou incomplet. Restauration annulée, aucune donnée modifiée.');

  const donnees = JSON.parse(s.contenu);
  const listes = {};
  for (const m of MAGASINS) {
    listes[m] = donnees[m] ?? [];
    if (!Array.isArray(listes[m])) throw new Error('Structure des données incorrecte.');
  }
  if (listes.journal_audit.length !== s.nombreEntrees) throw new Error('Le nombre d’entrées ne correspond pas à l’en-tête.');

  const ids = new Set();
  for (const m of MAGASINS) {
    for (const e of listes[m]) {
      const id = e?.id ?? e?.cleIdempotence;
      if (typeof id !== 'string') throw new Error('Une entrée est incorrecte. Restauration annulée.');
      if (ids.has(id)) throw new Error('Une entrée est en double. Restauration annulée.');
      ids.add(id);
    }
  }
  const probl = ledger.verifierIntegrite({ mouvements: listes.mouvements, transferts: listes.transferts });
  if (probl.length) throw new Error(`Sauvegarde incohérente (${probl[0]}). Restauration annulée.`);
  return { ...listes, date: s.date, nombreMouvements: listes.mouvements.length, nombreTransferts: listes.transferts.length };
}

export async function restaurer(v) {
  const db = await openDatabase();
  const tx = db.transaction([...MAGASINS, 'parametres'], 'readwrite');
  const taches = [];
  for (const m of MAGASINS) {
    const store = tx.objectStore(m);
    taches.push(store.clear());
    for (const e of v[m]) taches.push(store.add(e));
  }
  const params = tx.objectStore('parametres');
  taches.push(params.delete('pin')); // un nouveau PIN est créé après la restauration
  taches.push(params.put({ cle: 'tentatives', echecs: 0, dernier: 0 }));
  taches.push(params.put({ cle: 'derniereSauvegarde', date: v.date, nombre: v.nombreMouvements }));
  taches.push(tx.objectStore('journal_audit').add({
    id: crypto.randomUUID(), dateHeure: new Date().toISOString(), action: 'RESTAURATION',
    entite: 'parametre', entiteId: 'sauvegarde', avant: null, apres: { dateSauvegarde: v.date }, motif: null, operationId: null,
  }));
  await Promise.all(taches);
  await tx.done;
}
