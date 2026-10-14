/**
 * SunuÉcole — Formatage : montants FCFA, dates en français, durées,
 * libellés métiers (statuts, moyens de paiement, rôles…).
 * Tout est centralisé ici pour garantir une cohérence parfaite à l'écran.
 */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ */
/* Montants                                                            */
/* ------------------------------------------------------------------ */
export const xof = (n) => `${nf0.format(Math.round(Number(n) || 0))} FCFA`;
export const xofShort = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf1.format(v / 1e9)} Md`;
  if (a >= 1e6) return `${nf1.format(v / 1e6)} M`;
  if (a >= 1e4) return `${nf0.format(Math.round(v / 1e3))} k`;
  return nf0.format(v);
};
export const moneyClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
export const num = (n, d = 0) => (d === 0 ? nf0.format(Number(n) || 0) : d === 1 ? nf1.format(Number(n) || 0) : nf2.format(Number(n) || 0));
export const note = (n) => (n === null || n === undefined || n === '' ? '—' : nf2.format(Number(n)));
export const pct = (n, d = 1) => `${(d === 0 ? nf0 : nf1).format(Number(n) || 0)} %`;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */
const dateOnly = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : v);
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(typeof v === 'string' && v.length === 10 ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const dateFr = (v, opts) => {
  const d = toDate(dateOnly(v));
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', opts || { day: '2-digit', month: 'short', year: 'numeric' });
};
export const dateLong = (v) => dateFr(v, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dateCourt = (v) => dateFr(v, { day: '2-digit', month: '2-digit', year: '2-digit' });
export const moisFr = (v) => {
  const d = toDate(`${String(v).slice(0, 7)}-15`);
  return d ? d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '—';
};
export const moisCourt = (v) => {
  const d = toDate(`${String(v).slice(0, 7)}-15`);
  return d ? d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : '';
};
export const heureFr = (v) => {
  if (!v) return '—';
  const s = String(v);
  return s.length >= 16 ? s.slice(11, 16) : s;
};
export const dateTimeFr = (v) => {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** « il y a 3 h », « hier », « il y a 2 jours » — lecture rapide des flux. */
export const relatif = (v) => {
  const d = toDate(v);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const fmt = (n, u) => (fut ? `dans ${n} ${u}` : `il y a ${n} ${u}`);
  if (abs < 45) return 'à l\'instant';
  if (abs < 3600) return fmt(Math.round(abs / 60), 'min');
  if (abs < 86400) return fmt(Math.round(abs / 3600), 'h');
  if (abs < 172800) return fut ? 'demain' : 'hier';
  if (abs < 2592000) return fmt(Math.round(abs / 86400), 'j');
  if (abs < 31536000) return fmt(Math.round(abs / 2592000), 'mois');
  return fmt(Math.round(abs / 31536000), 'an(s)');
};

export const joursEntre = (a, b) => {
  const d1 = toDate(dateOnly(a));
  const d2 = toDate(dateOnly(b));
  if (!d1 || !d2) return 0;
  return Math.round((d2 - d1) / 864e5);
};
export const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const ajouterJours = (v, n) => {
  const d = toDate(dateOnly(v)) || new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const jourNom = (dow) => JOURS_COURTS[Number(dow)] || '';

/* ------------------------------------------------------------------ */
/* Durées                                                              */
/* ------------------------------------------------------------------ */
export const duree = (minutes) => {
  const m = Math.round(Number(minutes) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
};

/* ------------------------------------------------------------------ */
/* Libellés métiers                                                    */
/* ------------------------------------------------------------------ */
export const STATUT_ELEVE = {
  inscrit: { label: 'Inscrit', tone: 'info' },
  actif: { label: 'Actif', tone: 'ok' },
  suspendu: { label: 'Suspendu', tone: 'warn' },
  transfere: { label: 'Transféré', tone: 'neutral' },
  radie: { label: 'Radié', tone: 'danger' },
  diplome: { label: 'Diplômé', tone: 'brand' },
  abandon: { label: 'Abandon', tone: 'danger' },
};

export const STATUT_PRESENCE = {
  present: { label: 'Présent', tone: 'ok', short: 'P', key: '1' },
  absent: { label: 'Absent', tone: 'danger', short: 'A', key: '2' },
  retard: { label: 'Retard', tone: 'warn', short: 'R', key: '3' },
  excuse: { label: 'Excusé', tone: 'info', short: 'E', key: '4' },
};

export const STATUT_FACTURE = {
  impayee: { label: 'Impayée', tone: 'danger' },
  partielle: { label: 'Partielle', tone: 'warn' },
  payee: { label: 'Payée', tone: 'ok' },
  en_retard: { label: 'En retard', tone: 'danger' },
  annulee: { label: 'Annulée', tone: 'neutral' },
  avoir: { label: 'Avoir', tone: 'info' },
};

export const METHODE_PAIEMENT = {
  orange_money: { label: 'Orange Money', color: '#ff7900', icon: 'smartphone' },
  wave: { label: 'Wave', color: '#1dcff1', icon: 'smartphone' },
  mtn_momo: { label: 'MTN MoMo', color: '#ffcc00', icon: 'smartphone' },
  moov_money: { label: 'Moov Money', color: '#005baa', icon: 'smartphone' },
  free_money: { label: 'Free Money', color: '#e60028', icon: 'smartphone' },
  especes: { label: 'Espèces', color: '#15803d', icon: 'banknote' },
  virement: { label: 'Virement', color: '#1d4ed8', icon: 'credit-card' },
  cheque: { label: 'Chèque', color: '#7c3aed', icon: 'receipt' },
  carte: { label: 'Carte', color: '#0f172a', icon: 'credit-card' },
};

export const ROLES = {
  super_admin: 'Super administrateur',
  direction: 'Direction',
  censeur: 'Censeur',
  comptable: 'Comptable',
  secretaire: 'Secrétariat',
  bibliothecaire: 'Bibliothécaire',
  infirmier: 'Infirmerie',
  enseignant: 'Enseignant',
  surveillant: 'Surveillant',
  parent: 'Parent / Tuteur',
  eleve: 'Élève',
};

export const CATEGORIES_DEPENSE = {
  salaires: 'Salaires', eau_electricite: 'Eau & électricité', fournitures: 'Fournitures',
  entretien: 'Entretien', transport: 'Transport', evenements: 'Événements',
  equipements: 'Équipements', impots: 'Impôts & taxes', autre: 'Autre',
};

export const CATEGORIES_FRAIS = {
  scolarite: 'Scolarité', inscription: 'Inscription', cantine: 'Cantine', transport: 'Transport',
  uniforme: 'Tenue & fournitures', activite: 'Activités', examen: 'Examens', internat: 'Internat', autre: 'Autre',
};

export const TYPES_INCIDENT = {
  retard: 'Retard', bavardage: 'Bavardage', bagarre: 'Bagarre', telephone: 'Téléphone',
  absence_non_justifiee: 'Absence non justifiée', insolence: 'Insolence',
  degradation: 'Dégradation', tricherie: 'Tricherie',
};

export const SEVERITES = { leger: { label: 'Léger', tone: 'info' }, moyen: { label: 'Moyen', tone: 'warn' }, grave: { label: 'Grave', tone: 'danger' } };
export const SANCTIONS = { avertissement: 'Avertissement', blame: 'Blâme', retenue: 'Retenue', exclusion_temporaire: 'Exclusion temporaire', exclusion_definitive: 'Exclusion définitive' };

export const TYPES_EVALUATION = {
  devoir: 'Devoir surveillé', composition: 'Composition', oral: 'Oral', projet: 'Projet',
  tp: 'TP', interrogation: 'Interrogation',
};

export const TYPES_EVENEMENT = {
  examen: 'Examen', conseil_classe: 'Conseil de classe', reunion: 'Réunion', ferie: 'Jour férié',
  sport: 'Sport', culturel: 'Culturel', remise_bulletins: 'Remise des bulletins',
  inscription: 'Inscriptions', formation: 'Formation', autre: 'Autre',
};

export const TYPES_DOCUMENT = {
  certificat_scolarite: 'Certificat de scolarité', releve_notes: 'Relevé de notes',
  attestation_reussite: 'Attestation de réussite', bulletin_dupli: 'Duplicata de bulletin',
  acte_naissance: 'Copie d\'acte de naissance',
};

export const TYPES_CONGE = {
  conge_annuel: 'Congé annuel', maladie: 'Congé maladie', maternite: 'Congé maternité',
  familial: 'Congé familial', sans_solde: 'Congé sans solde', evenement: 'Événement familial',
};

export const STATUT_CANDIDATURE = {
  nouveau: { label: 'Nouveau', tone: 'info' }, dossier_complet: { label: 'Dossier complet', tone: 'info' },
  entretien: { label: 'Entretien', tone: 'warn' }, teste: { label: 'Testé', tone: 'warn' },
  admis: { label: 'Admis', tone: 'ok' }, liste_attente: { label: 'Liste d\'attente', tone: 'neutral' },
  refuse: { label: 'Refusé', tone: 'danger' }, inscrit: { label: 'Inscrit', tone: 'brand' },
};

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */
export const initials = (first = '', last = '') => `${String(first)[0] || ''}${String(last)[0] || ''}`.toUpperCase();
export const nomComplet = (o = {}) => `${o.first_name || o.firstName || ''} ${o.last_name || o.lastName || ''}`.trim();

/** Couleur déterministe pour un avatar sans photo. */
const COLORS = ['#0e7c66', '#1d4ed8', '#b45309', '#be123c', '#4d7c0f', '#7c3aed', '#0f766e', '#c2410c', '#155e75', '#a21caf', '#0369a1', '#166534'];
export function couleurAvatar(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Libellé lisible pour une clé snake_case. */
export const humanize = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Tronque proprement un texte long. */
export const tronquer = (s, n = 60) => {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Normalise un numéro sénégalais pour l'affichage : +221 77 123 45 67. */
export const telFr = (p) => {
  const s = String(p || '').replace(/\D/g, '');
  if (!s) return '—';
  if (s.startsWith('221') && s.length === 12) return `+221 ${s.slice(3, 5)} ${s.slice(5, 8)} ${s.slice(8, 10)} ${s.slice(10)}`;
  if (s.length === 9) return `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 7)} ${s.slice(7)}`;
  return String(p);
};

/** Taille de fichier lisible. */
export const tailleFichier = (b) => {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1048576) return `${nf1.format(n / 1024)} Ko`;
  return `${nf1.format(n / 1048576)} Mo`;
};

/** Mention scolaire selon la moyenne (barème français sur 20). */
export function mention(avg) {
  const v = Number(avg);
  if (Number.isNaN(v)) return { label: '—', tone: 'neutral' };
  if (v >= 18) return { label: 'Excellent', tone: 'ok' };
  if (v >= 16) return { label: 'Très Bien', tone: 'ok' };
  if (v >= 14) return { label: 'Bien', tone: 'ok' };
  if (v >= 12) return { label: 'Assez Bien', tone: 'info' };
  if (v >= 10) return { label: 'Passable', tone: 'warn' };
  return { label: 'Insuffisant', tone: 'danger' };
}

/** Couleur d'une note sur 20 (lecture immédiate dans les grilles). */
export function etatNote(score, max = 20) {
  const v = Number(score);
  if (Number.isNaN(v)) return 'empty';
  const r = v / max;
  if (r >= 0.7) return 'ok';
  if (r >= 0.5) return 'mid';
  return 'low';
}

export default { xof, xofShort, dateFr, relatif, mention, num, note, pct };

/** Âge révolu en années à partir d'une date de naissance (AAAA-MM-JJ). */
export function ageFrom(birth, at = null) {
  if (!birth) return null;
  const b = new Date(`${String(birth).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  const n = at ? new Date(at) : new Date();
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) age -= 1;
  return age < 0 ? null : age;
}

/** Âge détaillé : « 12 ans 4 mois » (utile pour l'affectation en classe). */
export function ageDetail(birth) {
  const a = ageFrom(birth);
  if (a == null) return '';
  const b = new Date(`${String(birth).slice(0, 10)}T00:00:00Z`);
  const n = new Date();
  let months = (n.getUTCFullYear() - b.getUTCFullYear()) * 12 + n.getUTCMonth() - b.getUTCMonth();
  if (n.getUTCDate() < b.getUTCDate()) months -= 1;
  months -= a * 12;
  return `${a} an${a > 1 ? 's' : ''}${months ? ` ${months} mois` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Dictionnaires : normalisation (les valeurs sont des chaînes ou des   */
/* objets { label, tone, icon }). Ces deux helpers évitent les tests    */
/* répandus dans les vues.                                              */
/* ------------------------------------------------------------------ */
/** Libellé lisible d'une clé de dictionnaire. */
export function dictLabel(dict, key, fallback = null) {
  if (key == null || key === '') return fallback ?? '—';
  const v = dict?.[key];
  if (!v) return fallback ?? String(key);
  return typeof v === 'string' ? v : (v.label || fallback || String(key));
}
/** Teinte (badge) associée à une clé. */
export function dictTone(dict, key, fallback = 'neutral') {
  const v = dict?.[key];
  return v && typeof v === 'object' ? (v.tone || fallback) : fallback;
}
/** Liste [{value,label,tone,icon}] prête pour un <select> ou des badges. */
export function dictEntries(dict) {
  return Object.entries(dict || {}).map(([value, v]) => ({
    value,
    label: typeof v === 'string' ? v : (v.label || value),
    tone: typeof v === 'object' ? v.tone : 'neutral',
    icon: typeof v === 'object' ? v.icon : null,
    short: typeof v === 'object' ? v.short : null,
  }));
}
