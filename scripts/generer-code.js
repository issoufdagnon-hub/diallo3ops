#!/usr/bin/env node
// Génère un code d'activation pour un identifiant d'appareil donné.
// Usage : ACTIVATION_SECRET=maClé node scripts/generer-code.js <deviceId>
//
// Vous pouvez aussi l'utiliser dans un workflow GitHub Actions
// pour générer les codes à distance.

import { createHmac } from 'crypto';

const secret = process.env.ACTIVATION_SECRET;
const deviceId = process.argv[2];

if (!secret) {
  console.error('Erreur : définissez la variable ACTIVATION_SECRET');
  console.error('Exemple : ACTIVATION_SECRET=maClé node scripts/generer-code.js abc123');
  process.exit(1);
}

if (!deviceId) {
  console.error('Erreur : indiquez le deviceId');
  console.error('Exemple : ACTIVATION_SECRET=maClé node scripts/generer-code.js abc123');
  process.exit(1);
}

const hmac = createHmac('sha256', secret).update(deviceId).digest('hex');
const code = hmac.slice(0, 8).toUpperCase();

console.log(`\nIdentifiant : ${deviceId}`);
console.log(`Code d'activation : ${code}\n`);
