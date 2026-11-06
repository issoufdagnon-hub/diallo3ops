import { useEffect, useState } from 'react';
import { OPERATEURS, formaterFCFA, soldeOperateur } from '../domain/ledger.js';
import {
  enregistrerSoldeInitial, enregistrerRecharge, creerTransfert, annulerTransfert,
  modifierTransfert, changerStatutPaiement, lireMouvements, lireTransferts, nouvelleCle,
} from '../db/repository.js';

const TYPES = { SOLDE_INITIAL: 'Solde initial', RECHARGEMENT: 'Rechargement', TRANSFERT: 'Transfert', ANNULATION: 'Annulation' };
const STATUTS = { ACTIF: 'Actif', ANNULE: 'Annulé', REMPLACE: 'Remplacé' };
const PAIEMENTS = { PAYE: 'Payé', NON_PAYE: 'Non payé' };
const ONGLETS = { bord: 'Tableau de bord', solde: 'Solde', nouveau: 'Nouveau transfert', historique: 'Historique' };
const dateFr = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Bamako', dateStyle: 'short', timeStyle: 'short' });

export default function Operateur({ operateur, onRetour }) {
  const [onglet, setOnglet] = useState('bord');
  const [mouvements, setMouvements] = useState([]);
  const [transferts, setTransferts] = useState([]);
  const [message, setMessage] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filtres, setFiltres] = useState({ du: '', au: '', statut: '', paiement: '', recherche: '' });
  const nom = OPERATEURS[operateur];

  async function recharger() {
    setMouvements(await lireMouvements(operateur));
    setTransferts(await lireTransferts(operateur));
  }
  useEffect(() => { recharger(); }, [operateur]);

  // Exécute une action : une seule à la fois, rechargement après succès.
  async function agir(fn, okMessage) {
    if (occupe) return;
    setOccupe(true);
    try {
      await fn();
      setMessage(okMessage);
      setEditId(null);
      await recharger();
      return true;
    } catch (err) {
      setMessage(err.message);
      return false;
    } finally {
      setOccupe(false);
    }
  }

  const solde = soldeOperateur(mouvements, operateur);
  const actifs = transferts.filter((t) => t.statutTransfert === 'ACTIF');

  return (
    <main>
      <div className="entete">
        <button className="secondaire petit" onClick={onRetour}>← Accueil</button>
        <h1>{nom}</h1>
      </div>
      <nav className="onglets">
        {Object.entries(ONGLETS).map(([k, v]) => (
          <button key={k} className={onglet === k ? 'actif' : ''} onClick={() => { setOnglet(k); setMessage(''); setEditId(null); }}>{v}</button>
        ))}
      </nav>
      <p className="erreur">{message}</p>

      {onglet === 'bord' && <Bord solde={solde} mouvements={mouvements} transferts={transferts} actifs={actifs}
        filtres={filtres} setFiltres={setFiltres} setOnglet={setOnglet} />}

      {onglet === 'solde' && (
        <>
          <div className="carte"><span className="info">Solde disponible</span><div className="gros">{formaterFCFA(solde)}</div></div>
          {mouvements.length === 0 ? (
            <FormMontant libelle="Solde de départ" bouton="Définir le solde initial" disabled={occupe}
              onSubmit={(montant) => agir(() => enregistrerSoldeInitial({ operateur, montant, cle: nouvelleCle() }), 'Solde initial enregistré.')} />
          ) : (
            <FormMontant libelle="Enregistrer un rechargement" bouton="Enregistrer la recharge" disabled={occupe}
              onSubmit={(montant) => agir(() => enregistrerRecharge({ operateur, montant, cle: nouvelleCle() }), 'Recharge enregistrée.')} />
          )}
          <h3>Mouvements</h3>
          {[...mouvements].sort((a, b) => b.dateHeure.localeCompare(a.dateHeure)).map((m) => (
            <div className="ligne" key={m.id}>
              <span>{TYPES[m.type]}<br /><small className="info">{dateFr(m.dateHeure)}</small></span>
              <strong className={m.montant < 0 ? 'neg' : 'pos'}>{m.montant > 0 ? '+' : ''}{formaterFCFA(m.montant)}</strong>
            </div>
          ))}
          {mouvements.length === 0 && <p className="info">Aucun mouvement.</p>}
        </>
      )}

      {onglet === 'nouveau' && (
        <FormTransfert occupe={occupe} nomOperateur={nom}
          onSubmit={async (valeurs) => {
            const ok = await agir(() => creerTransfert({ operateur, ...valeurs, cle: nouvelleCle() }), 'Transfert enregistré.');
            if (ok) setOnglet('historique');
          }} />
      )}

      {onglet === 'historique' && (
        <Historique transferts={transferts} filtres={filtres} setFiltres={setFiltres} occupe={occupe}
          editId={editId} setEditId={setEditId}
          onPayer={(t, statut) => agir(() => changerStatutPaiement({ transfertId: t.id, statutPaiement: statut, cle: nouvelleCle() }), 'Statut de paiement mis à jour.')}
          onAnnuler={(t) => {
            const motif = window.prompt('Motif de l’annulation (au moins 3 caractères) :');
            if (motif === null) return;
            agir(() => annulerTransfert({ transfertId: t.id, motif, cle: nouvelleCle() }), 'Transfert annulé. Le montant est revenu sur le solde.');
          }}
          onModifier={(t, champs, motif) => agir(() => modifierTransfert({ transfertId: t.id, champs, motif, cle: nouvelleCle() }), 'Transfert modifié. L’ancienne version reste dans l’historique.')} />
      )}
    </main>
  );
}

function Bord({ solde, mouvements, transferts, actifs, filtres, setFiltres, setOnglet }) {
  const total = actifs.reduce((s, t) => s + t.montant, 0);
  const payes = actifs.filter((t) => t.statutPaiement === 'PAYE').length;
  const annules = transferts.filter((t) => t.statutTransfert === 'ANNULE').length;
  const rechargements = mouvements.filter((m) => m.type === 'RECHARGEMENT').reduce((s, m) => s + m.montant, 0);

  // Solde restant après chaque transfert, calculé sur le journal des mouvements.
  const restantPar = new Map();
  let cumul = 0;
  [...mouvements].sort((a, b) => a.dateHeure.localeCompare(b.dateHeure)).forEach((m) => {
    cumul += m.montant;
    if (m.type === 'TRANSFERT') restantPar.set(m.referenceId, cumul);
  });

  const rech = filtres.recherche.trim().toLowerCase();
  const liste = [...transferts]
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation))
    .filter((t) => !rech || t.nom.toLowerCase().includes(rech) || t.numero.includes(rech))
    .slice(0, 30);

  return (
    <>
      <div className="carte"><span className="info">Solde disponible</span><div className="gros">{formaterFCFA(solde)}</div></div>
      <div className="actions-haut">
        <button onClick={() => setOnglet('nouveau')}>+ Nouveau transfert</button>
        <button className="secondaire" onClick={() => setOnglet('historique')}>Historique</button>
      </div>
      <div className="grille">
        <div className="carte"><span className="info">Transferts actifs</span><strong>{actifs.length}</strong></div>
        <div className="carte"><span className="info">Montant transféré</span><strong>{formaterFCFA(total)}</strong></div>
        <div className="carte"><span className="info">Payés</span><strong className="paye">{payes}</strong></div>
        <div className="carte"><span className="info">Non payés</span><strong className="non-paye">{actifs.length - payes}</strong></div>
        <div className="carte"><span className="info">Annulés</span><strong>{annules}</strong></div>
        <div className="carte"><span className="info">Total rechargé</span><strong>{formaterFCFA(rechargements)}</strong></div>
      </div>
      <div className="bloc-recherche">
        <input placeholder="Rechercher un nom ou un numéro" value={filtres.recherche}
          onChange={(e) => setFiltres({ ...filtres, recherche: e.target.value })} />
      </div>
      <div className="tableau-titre"><h3>Liste des transferts</h3><span className="info">{transferts.length}</span></div>
      <div className="tr tr-tete"><div>Bénéficiaire</div><div>Envoyé</div><div>Restant</div><div>Date</div><div></div></div>
      {liste.map((t) => (
        <div className={`tr ${t.statutTransfert !== 'ACTIF' ? 'annule' : ''}`} key={t.id}>
          <div><strong>{t.nom}</strong><br /><small className="info">{t.numero}</small></div>
          <div className="envoye">{formaterFCFA(t.montant)}</div>
          <div className="restant">{restantPar.has(t.id) ? formaterFCFA(restantPar.get(t.id)) : '—'}</div>
          <div><small className="info">{dateFr(t.dateCreation)}</small></div>
          <div className={`pastille ${t.statutPaiement === 'PAYE' ? 'vert' : 'rouge'}`} title={PAIEMENTS[t.statutPaiement]}></div>
        </div>
      ))}
      {liste.length === 0 && <p className="info">Aucun transfert.</p>}
    </>
  );
}

function FormMontant({ libelle, bouton, onSubmit, disabled }) {
  const [valeur, setValeur] = useState('');
  return (
    <form className="bloc-edition" onSubmit={(e) => { e.preventDefault(); onSubmit(Number(valeur.replace(/\s/g, ''))); setValeur(''); }}>
      <p className="info">{libelle} :</p>
      <input inputMode="numeric" placeholder="Montant en FCFA" value={valeur} onChange={(e) => setValeur(e.target.value)} />
      <button type="submit" disabled={disabled}>{bouton}</button>
    </form>
  );
}

function FormTransfert({ onSubmit, occupe, nomOperateur }) {
  const [v, setV] = useState({ nom: '', numero: '', montant: '', statut: 'NON_PAYE' });
  return (
    <form className="bloc-edition" onSubmit={(e) => {
      e.preventDefault();
      onSubmit({ montant: Number(v.montant.replace(/\s/g, '')), beneficiaire: { nom: v.nom, numero: v.numero.replace(/\s/g, '') }, statutPaiement: v.statut });
    }}>
      <label>Nom du bénéficiaire<input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} /></label>
      <label>Numéro (8 chiffres)<input inputMode="numeric" maxLength={8} value={v.numero} onChange={(e) => setV({ ...v, numero: e.target.value })} /></label>
      <label>Montant (FCFA)<input inputMode="numeric" value={v.montant} onChange={(e) => setV({ ...v, montant: e.target.value })} /></label>
      <label>Statut de paiement du client
        <select value={v.statut} onChange={(e) => setV({ ...v, statut: e.target.value })}>
          <option value="NON_PAYE">Non payé</option>
          <option value="PAYE">Payé</option>
        </select>
      </label>
      <p className="info">Le crédit sort du solde {nomOperateur} dès l'enregistrement. Le statut de paiement ne change pas le solde.</p>
      <button type="submit" disabled={occupe}>Enregistrer le transfert</button>
    </form>
  );
}

function Historique({ transferts, filtres, setFiltres, occupe, editId, setEditId, onPayer, onAnnuler, onModifier }) {
  const rech = filtres.recherche.trim().toLowerCase();
  const liste = transferts
    .filter((t) => {
      const jour = t.dateCreation.slice(0, 10);
      if (filtres.du && jour < filtres.du) return false;
      if (filtres.au && jour > filtres.au) return false;
      if (filtres.statut && t.statutTransfert !== filtres.statut) return false;
      if (filtres.paiement && t.statutPaiement !== filtres.paiement) return false;
      if (rech && !(t.nom.toLowerCase().includes(rech) || t.numero.includes(rech))) return false;
      return true;
    })
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
  const totalActifs = liste.filter((t) => t.statutTransfert === 'ACTIF').reduce((s, t) => s + t.montant, 0);
  const maj = (champ) => (e) => setFiltres({ ...filtres, [champ]: e.target.value });

  return (
    <>
      <div className="bloc-edition">
        <label>Du <input type="date" value={filtres.du} onChange={maj('du')} /></label>
        <label>Au <input type="date" value={filtres.au} onChange={maj('au')} /></label>
        <label>Statut
          <select value={filtres.statut} onChange={maj('statut')}>
            <option value="">Tous</option>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Paiement
          <select value={filtres.paiement} onChange={maj('paiement')}>
            <option value="">Tous</option>
            <option value="PAYE">Payé</option>
            <option value="NON_PAYE">Non payé</option>
          </select>
        </label>
        <label>Rechercher (nom ou numéro)<input value={filtres.recherche} onChange={maj('recherche')} /></label>
      </div>
      <p className="info">{liste.length} transfert(s) affiché(s) — total actif : <strong>{formaterFCFA(totalActifs)}</strong></p>
      {liste.map((t) => (
        <div className={`carte ${t.statutTransfert !== 'ACTIF' ? 'annule' : ''}`} key={t.id}>
          <strong>{t.nom}</strong> · {t.numero}<br />
          <span>{formaterFCFA(t.montant)}</span> · <span className={t.statutPaiement === 'PAYE' ? 'paye' : 'non-paye'}>{PAIEMENTS[t.statutPaiement]}</span> · <em>{STATUTS[t.statutTransfert]}</em><br />
          <small className="info">Créé le {dateFr(t.dateCreation)}</small>
          {t.motif && <><br /><small className="info">Motif : {t.motif}</small></>}
          {t.statutTransfert === 'ACTIF' && (
            <div className="actions">
              <button disabled={occupe} onClick={() => onPayer(t, t.statutPaiement === 'PAYE' ? 'NON_PAYE' : 'PAYE')}>
                Marquer {t.statutPaiement === 'PAYE' ? 'non payé' : 'payé'}
              </button>
              <button className="secondaire" disabled={occupe} onClick={() => setEditId(editId === t.id ? null : t.id)}>Modifier</button>
              <button className="danger" disabled={occupe} onClick={() => onAnnuler(t)}>Annuler</button>
            </div>
          )}
          {editId === t.id && <FormModifier transfert={t} occupe={occupe} onSubmit={(champs, motif) => onModifier(t, champs, motif)} />}
        </div>
      ))}
      {liste.length === 0 && <p className="info">Aucun transfert ne correspond.</p>}
    </>
  );
}

function FormModifier({ transfert, occupe, onSubmit }) {
  const [v, setV] = useState({ nom: transfert.nom, numero: transfert.numero, montant: String(transfert.montant), statut: transfert.statutPaiement, motif: '' });
  return (
    <form className="bloc-edition" onSubmit={(e) => {
      e.preventDefault();
      onSubmit({ nom: v.nom, numero: v.numero, montant: Number(v.montant.replace(/\s/g, '')), statutPaiement: v.statut }, v.motif);
    }}>
      <label>Nom<input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} /></label>
      <label>Numéro<input inputMode="numeric" maxLength={8} value={v.numero} onChange={(e) => setV({ ...v, numero: e.target.value })} /></label>
      <label>Montant (FCFA)<input inputMode="numeric" value={v.montant} onChange={(e) => setV({ ...v, montant: e.target.value })} /></label>
      <label>Paiement
        <select value={v.statut} onChange={(e) => setV({ ...v, statut: e.target.value })}>
          <option value="NON_PAYE">Non payé</option>
          <option value="PAYE">Payé</option>
        </select>
      </label>
      <label>Motif de la modification<input placeholder="Au moins 3 caractères" value={v.motif} onChange={(e) => setV({ ...v, motif: e.target.value })} /></label>
      <button type="submit" disabled={occupe}>Enregistrer la modification</button>
    </form>
  );
}
