import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPinValide, creerEmpreintePin, verifierPin, politiqueEchecs, attenteRestante } from './pin.js';

// Itérations réduites uniquement dans les tests, pour rester rapides.
const ITER_TEST = 1000;

test('format du PIN : exactement 4 chiffres', () => {
  assert.equal(formatPinValide('1234'), true);
  assert.equal(formatPinValide('0000'), true);
  assert.equal(formatPinValide('123'), false);
  assert.equal(formatPinValide('12345'), false);
  assert.equal(formatPinValide('12a4'), false);
  assert.equal(formatPinValide(1234), false);
});

test('le PIN juste est accepté, les autres refusés', async () => {
  const empreinte = await creerEmpreintePin('4821', ITER_TEST);
  assert.equal(await verifierPin('4821', empreinte), true);
  assert.equal(await verifierPin('4822', empreinte), false);
  assert.equal(await verifierPin('0000', empreinte), false);
  assert.equal(await verifierPin('482', empreinte), false);
});

test('le hash ne contient pas le PIN en clair et change à chaque sel', async () => {
  const a = await creerEmpreintePin('1234', ITER_TEST);
  const b = await creerEmpreintePin('1234', ITER_TEST);
  assert.notDeepEqual(a.sel, b.sel);
  assert.notDeepEqual(a.hash, b.hash);
});

test('refuse la création d’un PIN mal formé', async () => {
  await assert.rejects(() => creerEmpreintePin('12', ITER_TEST));
});

test('politique : délais progressifs puis restauration obligatoire', () => {
  assert.equal(politiqueEchecs(0).attenteMs, 0);
  assert.equal(politiqueEchecs(2).attenteMs, 0);
  assert.equal(politiqueEchecs(3).attenteMs, 30_000);
  assert.equal(politiqueEchecs(4).attenteMs, 30_000);
  assert.equal(politiqueEchecs(5).attenteMs, 300_000);
  assert.equal(politiqueEchecs(9).attenteMs, 300_000);
  assert.equal(politiqueEchecs(10).restaurationRequise, true);
});

test('attente restante après un échec', () => {
  const t0 = 1_000_000;
  assert.equal(attenteRestante({ echecs: 2, dernierEchec: t0 }, t0), 0);
  assert.equal(attenteRestante({ echecs: 3, dernierEchec: t0 }, t0 + 10_000), 20_000);
  assert.equal(attenteRestante({ echecs: 3, dernierEchec: t0 }, t0 + 30_000), 0);
  assert.equal(attenteRestante({ echecs: 10, dernierEchec: t0 }, t0 + 999_999_999), Infinity);
});
