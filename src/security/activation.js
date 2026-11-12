// activation.js : système de code d'activation lié à l'appareil.
// Chaque installation génère un identifiant unique (deviceId).
// Le code d'activation = HMAC-SHA256(deviceId, clé secrète) tronqué à 8 caractères hex.
// Seul celui qui possède la clé secrète peut générer un code valide.

import { openDatabase } from '../db/database.js';

const STORE = 'parametres';
const CLE_DEVICE = 'deviceId';
const CLE_ACTIVATION = 'activation';

// Génère un identifiant aléatoire de 16 caractères hex.
function genererDeviceId() {
  const octets = new Uint8Array(8);
  crypto.getRandomValues(octets);
  return Array.from(octets, b => b.toString(16).padStart(2, '0')).join('');
}

// Lit ou crée le deviceId pour cette installation.
export async function obtenirDeviceId() {
  const db = await openDatabase();
  let enreg = await db.get(STORE, CLE_DEVICE);
  if (enreg?.valeur) return enreg.valeur;
  const id = genererDeviceId();
  await db.put(STORE, { cle: CLE_DEVICE, valeur: id });
  return id;
}

// Vérifie un code d'activation côté client en le comparant
// au résultat HMAC-SHA256(deviceId, clé secrète) tronqué.
// La clé secrète est intégrée dans le code (obfusquée).
// Ce n'est pas une sécurité parfaite (le code source est lisible),
// mais c'est suffisant pour empêcher un partage simple de l'APK.
async function calculerCode(deviceId) {
  // Clé secrète — sera remplacée au build par la vraie valeur.
  const CLE = '__ACTIVATION_SECRET__';
  const enc = new TextEncoder();
  const cle = await crypto.subtle.importKey(
    'raw', enc.encode(CLE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cle, enc.encode(deviceId));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8).toUpperCase();
}

// Vérifie si le code saisi correspond au deviceId.
export async function verifierCode(deviceId, codeSaisi) {
  const attendu = await calculerCode(deviceId);
  return codeSaisi.trim().toUpperCase() === attendu;
}

// Enregistre que l'activation a été validée.
export async function enregistrerActivation(deviceId) {
  const db = await openDatabase();
  await db.put(STORE, { cle: CLE_ACTIVATION, valeur: { deviceId, date: new Date().toISOString() } });
}

// Vérifie si l'app est déjà activée (et que le deviceId correspond).
// Si l'app a déjà des données (mouvements existants), elle est considérée
// comme une installation légitime antérieure et est activée automatiquement.
export async function estActivee() {
  const db = await openDatabase();
  const enreg = await db.get(STORE, CLE_ACTIVATION);
  if (enreg?.valeur) {
    const deviceId = await obtenirDeviceId();
    return enreg.valeur.deviceId === deviceId;
  }
  // Auto-activer les installations existantes qui ont déjà des données
  const nbMouvements = await db.count('mouvements');
  if (nbMouvements > 0) {
    const deviceId = await obtenirDeviceId();
    await enregistrerActivation(deviceId);
    return true;
  }
  return false;
}
