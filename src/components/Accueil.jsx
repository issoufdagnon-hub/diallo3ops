import { OPERATEURS } from '../domain/ledger.js';

export default function Accueil({ alertes, rappel, message, onOuvrir, onParametres, onSauvegarder, onRestaurer }) {
  return (
    <main>
      <h1>DIALLO 3 OPÉRATEURS</h1>
      {alertes.length > 0 && (
        <div className="carte alerte">
          Anomalie détectée : {alertes[0]}. Ne faites pas de nouvelle opération avant vérification. Consultez le journal.
        </div>
      )}
      {rappel && <div className="carte rappel">{rappel}</div>}
      {Object.entries(OPERATEURS).map(([id, nom]) => (
        <button key={id} className="carte carte-op" onClick={() => onOuvrir(id)}>
          <strong>{nom}</strong>
          <span className="info">Ouvrir l'espace {nom}</span>
        </button>
      ))}
      <button className="secondaire" onClick={onParametres}>Paramètres et journal</button>
      <button onClick={onSauvegarder}>Sauvegarder maintenant</button>
      <button className="secondaire" onClick={onRestaurer}>Restaurer une sauvegarde</button>
      <p className="erreur">{message}</p>
    </main>
  );
}
