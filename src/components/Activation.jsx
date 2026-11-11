import { useState } from 'react';
import { verifierCode, enregistrerActivation } from '../security/activation.js';

export default function Activation({ deviceId, onActive }) {
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function valider(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setEnCours(true);
    setErreur('');
    const ok = await verifierCode(deviceId, code);
    if (ok) {
      await enregistrerActivation(deviceId);
      onActive();
    } else {
      setErreur('Code invalide. Contactez votre fournisseur.');
      setEnCours(false);
    }
  }

  return (
    <main>
      <h1>Activation requise</h1>
      <div className="carte" style={{ textAlign: 'center', marginTop: 20 }}>
        <p style={{ fontSize: 14, color: '#555' }}>
          Communiquez cet identifiant à votre fournisseur pour obtenir votre code d'activation :
        </p>
        <p style={{
          fontSize: 28, fontWeight: 700, letterSpacing: 3,
          color: '#0f766e', margin: '16px 0', userSelect: 'all'
        }}>
          {deviceId}
        </p>
      </div>
      <form onSubmit={valider}>
        <label>Code d'activation :</label>
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="Entrez le code"
          maxLength={8}
          style={{ textAlign: 'center', fontSize: 22, letterSpacing: 4 }}
          autoComplete="off"
        />
        {erreur && <p className="erreur">{erreur}</p>}
        <button type="submit" disabled={enCours || code.trim().length < 8}>
          {enCours ? 'Vérification…' : 'Activer'}
        </button>
      </form>
    </main>
  );
}
