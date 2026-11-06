import { useEffect, useState } from 'react';
import { creerEmpreintePin, verifierPin, formatPinValide } from '../security/pin.js';
import { lirePinEtTentatives, definirPin } from '../db/pinRepository.js';
import { journaliser } from '../db/sauvegarde.js';
import { lireJournal } from '../db/repository.js';

const LIBELLE_ACTION = {
  CREATION: 'Création de transfert', MODIFICATION: 'Modification', ANNULATION: 'Annulation',
  RECHARGEMENT: 'Recharge', SOLDE_INITIAL: 'Solde initial', SAUVEGARDE: 'Sauvegarde',
  RESTAURATION: 'Restauration', ECHEC_PIN: 'Échec de PIN', DEVERROUILLAGE: 'Déverrouillage',
  CHANGEMENT_PIN: 'Changement de PIN',
};
const dateFr = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Bamako', dateStyle: 'short', timeStyle: 'short' });
const resumer = (o) => {
  if (!o) return '';
  const morceaux = [o.nom, o.numero, o.montant != null ? formatMontant(o.montant) : null, o.statutTransfert, o.statutPaiement, o.echecs != null ? `${o.echecs} échec(s)` : null];
  return morceaux.filter(Boolean).join(' · ') || JSON.stringify(o).slice(0, 120);
};
const formatMontant = (n) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`;

export function Parametres({ onRetour }) {
  const [vue, setVue] = useState('menu');
  return vue === 'journal'
    ? <Journal onRetour={() => setVue('menu')} />
    : <MenuParametres onRetour={onRetour} onJournal={() => setVue('journal')} />;
}

function MenuParametres({ onRetour, onJournal }) {
  const [protege, setProtege] = useState(null);
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    navigator.storage?.persisted?.().then((v) => setProtege(v === true)).catch(() => setProtege(false));
  }, []);

  async function changerPin(e) {
    e.preventDefault();
    try {
      const { empreinte } = await lirePinEtTentatives();
      if (!(await verifierPin(ancien, empreinte))) return setMessage('Ancien PIN incorrect.');
      if (!formatPinValide(nouveau)) return setMessage('Le nouveau PIN doit comporter 4 chiffres.');
      if (nouveau !== confirmation) return setMessage('Les deux nouveaux PIN ne correspondent pas.');
      await definirPin(await creerEmpreintePin(nouveau));
      await journaliser({ action: 'CHANGEMENT_PIN', entite: 'parametre', entiteId: 'pin' });
      setAncien(''); setNouveau(''); setConfirmation('');
      setMessage('PIN changé.');
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <main>
      <div className="entete">
        <button className="secondaire petit" onClick={onRetour}>← Accueil</button>
        <h1>Paramètres</h1>
      </div>
      <p className="erreur">{message}</p>
      <div className="carte">
        <span className="info">Protection contre l'effacement automatique :</span><br />
        <strong className={protege ? 'paye' : 'non-paye'}>{protege === null ? '…' : protege ? 'Activée' : 'Non activée'}</strong>
      </div>
      <form className="bloc-edition" onSubmit={changerPin}>
        <h3>Changer le code PIN</h3>
        <label>Ancien PIN<input type="password" inputMode="numeric" maxLength={4} value={ancien} onChange={(e) => setAncien(e.target.value)} /></label>
        <label>Nouveau PIN (4 chiffres)<input type="password" inputMode="numeric" maxLength={4} value={nouveau} onChange={(e) => setNouveau(e.target.value)} /></label>
        <label>Confirmer le nouveau PIN<input type="password" inputMode="numeric" maxLength={4} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <button type="submit">Changer le PIN</button>
      </form>
      <button onClick={onJournal}>Journal des opérations</button>
    </main>
  );
}

function Journal({ onRetour }) {
  const [entrees, setEntrees] = useState([]);
  useEffect(() => {
    lireJournal().then((liste) => setEntrees([...liste].sort((a, b) => b.dateHeure.localeCompare(a.dateHeure))));
  }, []);
  return (
    <main>
      <div className="entete">
        <button className="secondaire petit" onClick={onRetour}>← Paramètres</button>
        <h1>Journal</h1>
      </div>
      <p className="info">{entrees.length} entrée(s). Aucune entrée n'est supprimée ni modifiée.</p>
      {entrees.map((e) => (
        <div className="carte" key={e.id}>
          <strong>{LIBELLE_ACTION[e.action] ?? e.action}</strong><br />
          <small className="info">{dateFr(e.dateHeure)}</small>
          {e.motif && <><br /><small>Motif : {e.motif}</small></>}
          {e.avant && <><br /><small className="info">Avant : {resumer(e.avant)}</small></>}
          {e.apres && <><br /><small className="info">Après : {resumer(e.apres)}</small></>}
        </div>
      ))}
      {entrees.length === 0 && <p className="info">Aucune entrée.</p>}
    </main>
  );
}
