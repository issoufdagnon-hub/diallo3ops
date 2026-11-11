// Script exécuté dans le workflow CI après "npm run build".
// Remplace le placeholder __ACTIVATION_SECRET__ dans les fichiers JS compilés
// par la vraie clé secrète (variable d'environnement ACTIVATION_SECRET).

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const secret = process.env.ACTIVATION_SECRET;
if (!secret) {
  console.error('ERREUR : variable ACTIVATION_SECRET manquante');
  process.exit(1);
}

const DIST = 'dist/assets';
const fichiers = readdirSync(DIST).filter(f => f.endsWith('.js'));
let remplace = false;

for (const f of fichiers) {
  const chemin = join(DIST, f);
  let contenu = readFileSync(chemin, 'utf8');
  if (contenu.includes('__ACTIVATION_SECRET__')) {
    contenu = contenu.replace(/__ACTIVATION_SECRET__/g, secret);
    writeFileSync(chemin, contenu);
    console.log(`Secret injecté dans ${f}`);
    remplace = true;
  }
}

if (!remplace) {
  console.error('ATTENTION : aucun fichier ne contenait __ACTIVATION_SECRET__');
  process.exit(1);
}
