import { useEffect, useState } from 'react';
import LockScreen from './components/LockScreen.jsx';
import Accueil from './components/Accueil.jsx';
import Operateur from './components/Operateur.jsx';
import { Parametres } from './components/Parametres.jsx';
import { demanderStockagePersistant, verifierIntegriteBase } from './db/repository.js';
import { verifierFichier, restaurer, produireFichier, sauvegarderManuellement, rappelSauvegarde } from './db/sauvegarde.js';
import { lirePinEtTentatives } from './db/pinRepository.js';

export default function App() {
  const [ecran, setEcran] = useState('chargement');
  const [operateur, setOperateur] = useState(null);
  const [alertes, setAlertes] = useState([]);
  const [rappel, setRappel] = useState('');
  const [message, setMessage] = useState('');
  const [bloque, setBloque] = useState(false);

  // Vérifie qu'une seule fenêtre de l'application est ouverte.
  useEffect(() => {
    let canal = null;
    let autre = false;
    if ('BroadcastChannel' in window) {
      canal = new BroadcastChannel('diallo3ops-onglets');
      canal.onmessage = (ev) => {
        if (ev.data === 'ping') canal.postMessage('pong');
        if (ev.data === 'pong') autre = true;
      };
      canal.postMessage('ping');
    }
    const t = setTimeout(async () => {
      if (autre) return setEcran('dejaOuvert');
      demanderStockagePersistant();
      const { empreinte } = await lirePinEtTentatives();
      setEcran(empreinte ? 'verrou' : 'creation');
    }, 300);
    return () => { clearTimeout(t); canal?.close(); };
  }, []);

  async function ouvrirAccueil(msg = '') {
    setMessage(msg);
    setOperateur(null);
    setAlertes(await verifierIntegriteBase());
    setRappel(await rappelSauvegarde());
    setEcran('accueil');
  }

  async function sauvegarder() {
    try {
      const ok = await sauvegarderManuellement();
      await ouvrirAccueil(ok ? 'Sauvegarde enregistrée.' : 'Sauvegarde annulée.');
    } catch (err) {
      await ouvrirAccueil(err.message);
    }
  }

  // Restauration : vérification d'abord, sauvegarde de sécurité ensuite, puis remplacement.
  async function choisirRestauration() {
    const saisie = document.createElement('input');
    saisie.type = 'file';
    saisie.accept = '.json,application/json';
    saisie.onchange = async () => {
      const fichier = saisie.files[0];
      if (!fichier) return;
      try {
        const v = await verifierFichier(await fichier.text());
        const resume = `${v.nombreMouvements} mouvement(s), ${v.nombreTransferts} transfert(s)`;
        if (!window.confirm(`Restaurer la sauvegarde du ${v.date.slice(0, 10)} (${resume}) ? Les données actuelles seront remplacées. Une sauvegarde de l'état actuel est d'abord demandée.`)) return;
        const avant = await produireFichier('AVANT_RESTAURATION');
        if (!avant) return ouvrirAccueil('Restauration annulée : la sauvegarde de sécurité n’a pas été enregistrée.');
        await restaurer(v);
        setBloque(false);
        setEcran('creation');
      } catch (err) {
        if (ecran === 'bloque') setMessage(err.message);
        else await ouvrirAccueil(err.message);
      }
    };
    saisie.click();
  }

  if (ecran === 'chargement') return <main><p className="info">Chargement…</p></main>;
  if (ecran === 'dejaOuvert') return (
    <main>
      <h1>Déjà ouverte</h1>
      <p className="info">DIALLO 3 OPÉRATEURS est déjà ouverte dans un autre onglet. Fermez l'autre onglet, puis rechargez cette page.</p>
      <button onClick={() => window.location.reload()}>Recharger</button>
    </main>
  );
  if (ecran === 'creation' || ecran === 'verrou' || ecran === 'bloque') {
    return <LockScreen onDeverrouille={() => ouvrirAccueil()} onRestaurer={choisirRestauration} />;
  }
  if (ecran === 'parametres') return <Parametres onRetour={() => ouvrirAccueil()} />;
  if (ecran === 'operateur') return <Operateur operateur={operateur} onRetour={() => ouvrirAccueil()} />;
  return (
    <Accueil
      alertes={alertes}
      rappel={rappel}
      message={message}
      onOuvrir={(op) => { setOperateur(op); setEcran('operateur'); }}
      onParametres={() => setEcran('parametres')}
      onSauvegarder={sauvegarder}
      onRestaurer={choisirRestauration} />
  );
}
