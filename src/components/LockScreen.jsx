import { useEffect, useState } from 'react';
import { creerEmpreintePin, verifierPin, formatPinValide, politiqueEchecs, attenteRestante, PIN_LONGUEUR } from '../security/pin.js';
import { lirePinEtTentatives, definirPin, enregistrerEchecPin, reinitialiserEchecsPin } from '../db/pinRepository.js';

const style = {
  fontFamily: 'system-ui, sans-serif', maxWidth: 360, margin: '0 auto', padding: 24, textAlign: 'center',
};
const caseStyle = { width: 52, height: 60, fontSize: 28, textAlign: 'center', margin: 4, borderRadius: 12, border: '2px solid #0f766e' };

// Écran de verrouillage : création du PIN au premier lancement, puis déverrouillage.
export default function LockScreen({ onDeverrouille, onRestaurer }) {
  const [mode, setMode] = useState('chargement');
  const [tentatives, setTentatives] = useState({ echecs: 0, dernierEchec: 0 });
  const [empreinte, setEmpreinte] = useState(null);
  const [saisie, setSaisie] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [maintenant, setMaintenant] = useState(Date.now());
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    lirePinEtTentatives().then(({ empreinte: e, tentatives: t }) => {
      setEmpreinte(e);
      setTentatives(t);
      setMode(e ? 'deverrouillage' : 'creation');
    });
  }, []);

  // Met à jour le compte à rebours pendant une attente.
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const attente = attenteRestante(tentatives, maintenant);
  const restaurationRequise = politiqueEchecs(tentatives.echecs).restaurationRequise;

  async function creer(e) {
    e.preventDefault();
    if (!formatPinValide(saisie)) return setMessage(`Le PIN doit comporter ${PIN_LONGUEUR} chiffres.`);
    if (saisie !== confirmation) return setMessage('Les deux PIN ne correspondent pas.');
    setOccupe(true);
    await definirPin(await creerEmpreintePin(saisie));
    onDeverrouille();
  }

  async function deverrouiller(e) {
    e.preventDefault();
    if (occupe || attente > 0) return;
    setOccupe(true);
    if (await verifierPin(saisie, empreinte)) {
      await reinitialiserEchecsPin();
      onDeverrouille();
      return;
    }
    const nouveau = await enregistrerEchecPin(Date.now());
    setTentatives(nouveau);
    setSaisie('');
    setOccupe(false);
    setMessage('PIN incorrect.');
  }

  if (mode === 'chargement') return <main style={style}>…</main>;

  if (restaurationRequise) {
    return (
      <main style={style}>
        <h2>Accès bloqué</h2>
        <p>Trop de tentatives. Restaurez un fichier de sauvegarde pour continuer.</p>
        <button type="button" onClick={onRestaurer}>Restaurer une sauvegarde</button>
      </main>
    );
  }

  if (mode === 'creation') {
    return (
      <main style={style}>
        <h2>Créez votre code PIN</h2>
        <p>{PIN_LONGUEUR} chiffres. Il vous sera demandé à chaque ouverture.</p>
        <form onSubmit={creer}>
          <input type="password" inputMode="numeric" maxLength={PIN_LONGUEUR} value={saisie}
            onChange={(e) => setSaisie(e.target.value.replace(/\D/g, ''))} placeholder="PIN" style={caseStyle} />
          <br />
          <input type="password" inputMode="numeric" maxLength={PIN_LONGUEUR} value={confirmation}
            onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, ''))} placeholder="Confirmer" style={caseStyle} />
          <p style={{ color: '#b91c1c' }}>{message}</p>
          <button type="submit" disabled={occupe} style={{ padding: '12px 24px', fontSize: 18, borderRadius: 12 }}>
            Enregistrer le PIN
          </button>
        </form>
      </main>
    );
  }

  return (
    <main style={style}>
      <h2>Entrez votre PIN</h2>
      {attente > 0 && (
        <p style={{ color: '#b45309' }}>Réessayez dans {Math.ceil(attente / 1000)} s.</p>
      )}
      <form onSubmit={deverrouiller}>
        <input type="password" inputMode="numeric" maxLength={PIN_LONGUEUR} value={saisie} autoFocus
          disabled={attente > 0}
          onChange={(e) => setSaisie(e.target.value.replace(/\D/g, ''))} placeholder="••••" style={caseStyle} />
        <p style={{ color: '#b91c1c' }}>{message}</p>
        <button type="submit" disabled={occupe || attente > 0 || saisie.length !== PIN_LONGUEUR}
          style={{ padding: '12px 24px', fontSize: 18, borderRadius: 12 }}>
          Déverrouiller
        </button>
      </form>
    </main>
  );
}
