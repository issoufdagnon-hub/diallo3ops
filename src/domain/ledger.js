// ledger.js : logique métier pure (aucun accès au navigateur, testable avec node --test).
// Règle centrale : le solde d'un opérateur = somme de TOUS ses mouvements signés.
// Aucun mouvement n'est jamais supprimé ni modifié ; une annulation ajoute un mouvement compensateur.

export const OPERATEURS = Object.freeze({
  orange: 'Orange',
  malitel: 'Malitel',
  telecel: 'Telecel',
});

export const TYPE_MOUVEMENT = Object.freeze({
  SOLDE_INITIAL: 'SOLDE_INITIAL',
  RECHARGEMENT: 'RECHARGEMENT',
  TRANSFERT: 'TRANSFERT',
  ANNULATION: 'ANNULATION',
});

export const STATUT_TRANSFERT = Object.freeze({
  ACTIF: 'ACTIF',
  ANNULE: 'ANNULE',
  REMPLACE: 'REMPLACE',
});

export const STATUT_PAIEMENT = Object.freeze({
  PAYE: 'PAYE',
  NON_PAYE: 'NON_PAYE',
});

export class RegleMetierError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegleMetierError';
  }
}

const erreur = (message) => {
  throw new RegleMetierError(message);
};

// ---------- Validations ----------

export function verifierOperateur(operateur) {
  if (!Object.hasOwn(OPERATEURS, operateur)) erreur(`Opérateur inconnu : ${operateur}.`);
}

export function verifierMontant(montant) {
  if (!Number.isSafeInteger(montant) || montant <= 0) {
    erreur('Le montant doit être un nombre entier de FCFA, supérieur à zéro.');
  }
}

export function verifierMotif(motif) {
  if (typeof motif !== 'string' || motif.trim().length < 3) {
    erreur('Un motif d’au moins 3 caractères est obligatoire.');
  }
}

export function verifierNumero(numero) {
  if (!/^\d{8}$/.test(numero ?? '')) erreur('Le numéro doit comporter 8 chiffres.');
}

export function verifierStatutPaiement(statut) {
  if (!Object.hasOwn(STATUT_PAIEMENT, statut)) erreur('Statut de paiement invalide.');
}

// ---------- Calculs ----------

export function soldeOperateur(mouvements, operateur) {
  return mouvements
    .filter((m) => m.operateur === operateur)
    .reduce((total, m) => total + m.montant, 0);
}

export function formaterFCFA(montant) {
  return `${new Intl.NumberFormat('fr-FR').format(montant)} FCFA`;
}

function trouverTransfert(transferts, id) {
  const transfert = transferts.find((t) => t.id === id);
  if (!transfert) erreur('Transfert introuvable.');
  return transfert;
}

// Fabrique un mouvement financier (jamais modifié ensuite).
function mouvement(ctx, { type, operateur, montant, referenceId = null, motif = null }) {
  return {
    id: ctx.nouvelId(),
    type,
    operateur,
    montant,
    dateHeure: ctx.maintenant,
    referenceId,
    motif,
    operationId: ctx.operationId,
  };
}

// Fabrique une entrée du journal d'audit (ajout seul).
function trace(ctx, { action, entite, entiteId, avant = null, apres = null, motif = null }) {
  return {
    id: ctx.nouvelId(),
    dateHeure: ctx.maintenant,
    action,
    entite,
    entiteId,
    avant,
    apres,
    motif,
    operationId: ctx.operationId,
  };
}

const planVide = () => ({ mouvements: [], transfertsAjout: [], transfertsMaj: [], audit: [], resultat: {} });

// ---------- Opérations (chaque fonction renvoie un plan à écrire) ----------

export function planifierSoldeInitial({ mouvements, ctx, operateur, montant }) {
  verifierOperateur(operateur);
  verifierMontant(montant);
  if (mouvements.some((m) => m.operateur === operateur)) {
    erreur('Le solde initial ne peut être défini qu’avant tout mouvement sur cet opérateur.');
  }
  const m = mouvement(ctx, { type: TYPE_MOUVEMENT.SOLDE_INITIAL, operateur, montant });
  return {
    ...planVide(),
    mouvements: [m],
    audit: [trace(ctx, { action: 'SOLDE_INITIAL', entite: 'mouvement', entiteId: m.id, apres: m })],
    resultat: { mouvementId: m.id },
  };
}

export function planifierRecharge({ ctx, operateur, montant }) {
  verifierOperateur(operateur);
  verifierMontant(montant);
  const m = mouvement(ctx, { type: TYPE_MOUVEMENT.RECHARGEMENT, operateur, montant });
  return {
    ...planVide(),
    mouvements: [m],
    audit: [trace(ctx, { action: 'RECHARGEMENT', entite: 'mouvement', entiteId: m.id, apres: m })],
    resultat: { mouvementId: m.id },
  };
}

export function planifierTransfert({ mouvements, ctx, operateur, montant, beneficiaire, statutPaiement }) {
  verifierOperateur(operateur);
  verifierMontant(montant);
  verifierNumero(beneficiaire?.numero);
  verifierStatutPaiement(statutPaiement);

  const disponible = soldeOperateur(mouvements, operateur);
  if (montant > disponible) {
    erreur(`Solde insuffisant : ${formaterFCFA(disponible)} disponibles.`);
  }

  const transfert = {
    id: ctx.nouvelId(),
    operateur,
    nom: beneficiaire.nom?.trim() || 'Sans nom',
    numero: beneficiaire.numero,
    montant,
    dateCreation: ctx.maintenant,
    statutPaiement,
    statutTransfert: STATUT_TRANSFERT.ACTIF,
    motif: null,
    remplaceDe: null,
    remplacePar: null,
    dateAnnulation: null,
  };
  const debit = mouvement(ctx, {
    type: TYPE_MOUVEMENT.TRANSFERT,
    operateur,
    montant: -montant,
    referenceId: transfert.id,
  });
  return {
    ...planVide(),
    mouvements: [debit],
    transfertsAjout: [transfert],
    audit: [trace(ctx, { action: 'CREATION', entite: 'transfert', entiteId: transfert.id, apres: transfert })],
    resultat: { transfertId: transfert.id },
  };
}

export function planifierAnnulation({ transferts, ctx, transfertId, motif }) {
  verifierMotif(motif);
  const ancien = trouverTransfert(transferts, transfertId);
  if (ancien.statutTransfert !== STATUT_TRANSFERT.ACTIF) {
    erreur('Ce transfert est déjà annulé ou remplacé.');
  }
  const compensation = mouvement(ctx, {
    type: TYPE_MOUVEMENT.ANNULATION,
    operateur: ancien.operateur,
    montant: ancien.montant,
    referenceId: ancien.id,
    motif: motif.trim(),
  });
  const maj = {
    ...ancien,
    statutTransfert: STATUT_TRANSFERT.ANNULE,
    motif: motif.trim(),
    dateAnnulation: ctx.maintenant,
  };
  return {
    ...planVide(),
    mouvements: [compensation],
    transfertsMaj: [maj],
    audit: [trace(ctx, {
      action: 'ANNULATION', entite: 'transfert', entiteId: ancien.id,
      avant: ancien, apres: maj, motif: motif.trim(),
    })],
    resultat: { transfertId: ancien.id, mouvementId: compensation.id },
  };
}

// Modifier = annuler l'ancien transfert (compensation) + créer un nouveau transfert.
// Les deux traces restent dans le journal.
export function planifierModification({ mouvements, transferts, ctx, transfertId, champs = {}, motif }) {
  verifierMotif(motif);
  const ancien = trouverTransfert(transferts, transfertId);
  if (ancien.statutTransfert !== STATUT_TRANSFERT.ACTIF) {
    erreur('Seul un transfert actif peut être modifié.');
  }

  const operateur = ancien.operateur;
  const montant = champs.montant ?? ancien.montant;
  const statutPaiement = champs.statutPaiement ?? ancien.statutPaiement;
  const numero = champs.numero ?? ancien.numero;
  const nom = (champs.nom ?? ancien.nom).trim() || 'Sans nom';
  verifierMontant(montant);
  verifierStatutPaiement(statutPaiement);
  verifierNumero(numero);

  // Le solde disponible est celui d'avant le transfert d'origine.
  const disponible = soldeOperateur(mouvements, operateur) + ancien.montant;
  if (montant > disponible) {
    erreur(`Modification refusée : solde insuffisant (${formaterFCFA(disponible)} disponibles).`);
  }

  const nouveau = {
    id: ctx.nouvelId(),
    operateur,
    nom,
    numero,
    montant,
    dateCreation: ctx.maintenant,
    statutPaiement,
    statutTransfert: STATUT_TRANSFERT.ACTIF,
    motif: null,
    remplaceDe: ancien.id,
    remplacePar: null,
    dateAnnulation: null,
  };
  const compensation = mouvement(ctx, {
    type: TYPE_MOUVEMENT.ANNULATION,
    operateur,
    montant: ancien.montant,
    referenceId: ancien.id,
    motif: motif.trim(),
  });
  const debit = mouvement(ctx, {
    type: TYPE_MOUVEMENT.TRANSFERT,
    operateur,
    montant: -montant,
    referenceId: nouveau.id,
  });
  const remplace = {
    ...ancien,
    statutTransfert: STATUT_TRANSFERT.REMPLACE,
    motif: motif.trim(),
    remplacePar: nouveau.id,
  };
  return {
    ...planVide(),
    mouvements: [compensation, debit],
    transfertsAjout: [nouveau],
    transfertsMaj: [remplace],
    audit: [trace(ctx, {
      action: 'MODIFICATION', entite: 'transfert', entiteId: ancien.id,
      avant: ancien, apres: remplace, motif: motif.trim(),
    })],
    resultat: { transfertId: nouveau.id, remplace: ancien.id },
  };
}

// Le statut de paiement du client ne touche jamais au solde de l'opérateur.
export function planifierChangementPaiement({ transferts, ctx, transfertId, statutPaiement }) {
  verifierStatutPaiement(statutPaiement);
  const ancien = trouverTransfert(transferts, transfertId);
  if (ancien.statutTransfert !== STATUT_TRANSFERT.ACTIF) {
    erreur('Le statut de paiement ne se modifie que sur un transfert actif.');
  }
  const maj = { ...ancien, statutPaiement };
  return {
    ...planVide(),
    transfertsMaj: [maj],
    audit: [trace(ctx, {
      action: 'MODIFICATION', entite: 'transfert', entiteId: ancien.id, avant: ancien, apres: maj,
    })],
    resultat: { transfertId: ancien.id },
  };
}

// ---------- Contrôle d'intégrité ----------
// Pour chaque transfert : somme de ses mouvements = −montant si ACTIF, 0 sinon.
// Renvoie la liste des anomalies (vide = tout est cohérent). Ne corrige jamais rien.
export function verifierIntegrite({ mouvements, transferts }) {
  const anomalies = [];
  const idsMouvements = new Set();
  const idsTransferts = new Set(transferts.map((t) => t.id));
  const sommeParTransfert = new Map();

  for (const m of mouvements) {
    if (idsMouvements.has(m.id)) anomalies.push(`Mouvement en double : ${m.id}.`);
    idsMouvements.add(m.id);
    if (m.referenceId) {
      if (!idsTransferts.has(m.referenceId)) {
        anomalies.push(`Mouvement ${m.id} rattaché à un transfert introuvable.`);
      }
      sommeParTransfert.set(m.referenceId, (sommeParTransfert.get(m.referenceId) ?? 0) + m.montant);
    }
  }

  for (const t of transferts) {
    const attendu = t.statutTransfert === STATUT_TRANSFERT.ACTIF ? -t.montant : 0;
    const reel = sommeParTransfert.get(t.id) ?? 0;
    if (reel !== attendu) {
      anomalies.push(`Transfert ${t.id} : mouvements = ${reel} FCFA, attendu = ${attendu} FCFA.`);
    }
  }

  for (const operateur of Object.keys(OPERATEURS)) {
    const solde = soldeOperateur(mouvements, operateur);
    if (solde < 0) anomalies.push(`Solde négatif pour ${OPERATEURS[operateur]} : ${solde} FCFA.`);
  }
  return anomalies;
}
