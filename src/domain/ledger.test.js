import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from './ledger.js';

function contexte() {
  let n = 0;
  return { nouvelId: () => `id-${++n}`, maintenant: '2026-11-05T12:00:00.000Z', operationId: 'test' };
}
const etat = () => ({ mouvements: [], transferts: [] });

function appliquer(e, plan) {
  e.mouvements.push(...plan.mouvements);
  e.transferts.push(...plan.transfertsAjout);
  for (const maj of plan.transfertsMaj) {
    const i = e.transferts.findIndex((t) => t.id === maj.id);
    e.transferts[i] = maj;
  }
  return e;
}
const solde = (e, operateur = 'orange') => L.soldeOperateur(e.mouvements, operateur);
const actifs = (e) => e.transferts.filter((t) => t.statutTransfert === L.STATUT_TRANSFERT.ACTIF);
const benef = { nom: 'Awa', numero: '70123456' };

function ouvrirCompte(e, ctx, montant = 10000) {
  return appliquer(e, L.planifierSoldeInitial({ mouvements: e.mouvements, ctx, operateur: 'orange', montant }));
}
function faireTransfert(e, ctx, montant, statutPaiement = 'NON_PAYE') {
  appliquer(e, L.planifierTransfert({
    mouvements: e.mouvements, transferts: e.transferts, ctx,
    operateur: 'orange', montant, beneficiaire: benef, statutPaiement,
  }));
  return actifs(e).at(-1);
}

test('solde initial, recharge et transfert se calculent depuis le journal', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  appliquer(e, L.planifierRecharge({ ctx, operateur: 'orange', montant: 5000 }));
  assert.equal(solde(e), 15000);
  faireTransfert(e, ctx, 3000);
  assert.equal(solde(e), 12000);
  assert.deepEqual(L.verifierIntegrite(e), []);
});

test('annulation : rembourse une seule fois et garde le transfert dans le journal', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  const t = faireTransfert(e, ctx, 3000);
  appliquer(e, L.planifierAnnulation({ transferts: e.transferts, ctx, transfertId: t.id, motif: 'Numéro erroné' }));
  assert.equal(solde(e), 10000, 'le solde revient exactement à sa valeur initiale, sans double remboursement');
  assert.equal(e.transferts.length, 1);
  assert.equal(e.transferts[0].statutTransfert, 'ANNULE');
  assert.equal(actifs(e).length, 0);
  assert.deepEqual(L.verifierIntegrite(e), []);
  assert.throws(
    () => L.planifierAnnulation({ transferts: e.transferts, ctx, transfertId: t.id, motif: 'Encore' }),
    L.RegleMetierError,
  );
});

test('refuse un transfert qui rendrait le solde négatif', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 1000);
  assert.throws(() => L.planifierTransfert({
    mouvements: e.mouvements, transferts: e.transferts, ctx,
    operateur: 'orange', montant: 1500, beneficiaire: benef, statutPaiement: 'NON_PAYE',
  }), L.RegleMetierError);
  assert.equal(solde(e), 1000);
});

test('modification : ancien montant compensé, nouveau débité, deux traces conservées', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  const t = faireTransfert(e, ctx, 3000);
  appliquer(e, L.planifierModification({
    mouvements: e.mouvements, transferts: e.transferts, ctx,
    transfertId: t.id, champs: { montant: 5000 }, motif: 'Erreur de saisie',
  }));
  assert.equal(solde(e), 5000);
  assert.equal(e.transferts.length, 2);
  assert.equal(e.transferts[0].statutTransfert, 'REMPLACE');
  assert.equal(actifs(e).length, 1);
  assert.equal(e.mouvements.length, 4, 'solde initial, transfert, compensation, nouveau transfert');
  assert.deepEqual(L.verifierIntegrite(e), []);

  const nouveau = actifs(e)[0];
  assert.throws(() => L.planifierModification({
    mouvements: e.mouvements, transferts: e.transferts, ctx,
    transfertId: nouveau.id, champs: { montant: 10001 }, motif: 'Trop',
  }), L.RegleMetierError);
});

test('le statut de paiement ne modifie jamais le solde', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  const t = faireTransfert(e, ctx, 2000, 'NON_PAYE');
  const avant = solde(e);
  appliquer(e, L.planifierChangementPaiement({ transferts: e.transferts, ctx, transfertId: t.id, statutPaiement: 'PAYE' }));
  assert.equal(solde(e), avant);
  assert.equal(actifs(e)[0].statutPaiement, 'PAYE');
  assert.deepEqual(L.verifierIntegrite(e), []);
});

test('le solde initial ne se définit qu’avant tout mouvement', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  faireTransfert(e, ctx, 1000);
  assert.throws(() => L.planifierSoldeInitial({ mouvements: e.mouvements, ctx, operateur: 'orange', montant: 5000 }), L.RegleMetierError);
});

test('détecte une écriture ajoutée directement dans le journal', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  const t = faireTransfert(e, ctx, 3000);
  e.mouvements.push({
    id: 'faux', type: 'ANNULATION', operateur: 'orange', montant: 3000,
    referenceId: t.id, dateHeure: ctx.maintenant, motif: 'x', operationId: 'x',
  });
  assert.ok(L.verifierIntegrite(e).length > 0);
});

test('valide montants, numéro et motif', () => {
  const ctx = contexte();
  const e = etat();
  ouvrirCompte(e, ctx, 10000);
  const base = { mouvements: e.mouvements, transferts: e.transferts, ctx, operateur: 'orange', statutPaiement: 'NON_PAYE' };
  assert.throws(() => L.planifierTransfert({ ...base, montant: 0, beneficiaire: benef }), L.RegleMetierError);
  assert.throws(() => L.planifierTransfert({ ...base, montant: 1500.5, beneficiaire: benef }), L.RegleMetierError);
  assert.throws(() => L.planifierTransfert({ ...base, montant: 500, beneficiaire: { nom: 'X', numero: '123' } }), L.RegleMetierError);
  const t = faireTransfert(e, ctx, 500);
  assert.throws(() => L.planifierAnnulation({ transferts: e.transferts, ctx, transfertId: t.id, motif: 'ab' }), L.RegleMetierError);
});
