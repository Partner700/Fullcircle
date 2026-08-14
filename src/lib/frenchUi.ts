import { useEffect } from 'react';

const TEXT_FR: Record<string, string> = {
  'Preparing your Full Circle...': 'Préparation de Full Circle...',
  'Full Circle needs Supabase config': 'Full Circle a besoin de la configuration Supabase',
  'Dashboard': 'Tableau de bord',
  'Overview': 'Vue d’ensemble',
  'Today': 'Aujourd’hui',
  "Today's Reading": 'Lecture du jour',
  'Today’s Reading': 'Lecture du jour',
  'Daily Game': 'Jeu du jour',
  'Weekly Quiz': 'Quiz hebdomadaire',
  'Arena': 'Arène',
  'Market': 'Marché',
  'Tent': 'Tente',
  'Settings': 'Paramètres',
  'Profile': 'Profil',
  'Display Name': 'Nom affiché',
  'User Name': 'Nom d’utilisateur',
  'WhatsApp Number': 'Numéro WhatsApp',
  "WhatsApp Number (so your sentry and instructor can contact you)": 'Numéro WhatsApp (pour que votre sentinelle et votre instructeur puissent vous joindre)',
  'Country': 'Pays',
  'Language': 'Langue',
  'Birthday': 'Anniversaire',
  'Save': 'Enregistrer',
  'Saved successfully': 'Enregistré avec succès',
  'Your profile, stats, and preferences': 'Votre profil, vos statistiques et vos préférences',
  'Change Password': 'Changer le mot de passe',
  'Update Password': 'Mettre à jour le mot de passe',
  'Create password': 'Créer un mot de passe',
  'Confirm password': 'Confirmer le mot de passe',
  'Sign In': 'Se connecter',
  'Sign Up': 'Créer un compte',
  'Sign Out': 'Se déconnecter',
  'Email': 'E-mail',
  'Password': 'Mot de passe',
  'Old Password': 'Ancien mot de passe',
  'New Password': 'Nouveau mot de passe',
  'Confirm New Password': 'Confirmer le nouveau mot de passe',
  'Subscription': 'Abonnement',
  'Install the App': 'Installer l’application',
  'Install App': 'Installer l’application',
  'Not Now': 'Pas maintenant',
  'Install the app on your device for faster and easier access.': 'Installez l’application sur votre appareil pour un accès plus rapide et plus simple.',
  'Verse of the Day': 'Verset du jour',
  'Key Verse': 'Verset clé',
  'Daily Scripture': 'Lecture biblique',
  'Best Verse': 'Meilleur verset',
  'Meditation of the Day': 'Méditation du jour',
  'Quote of the Day': 'Citation du jour',
  'Submit Meditation': 'Soumettre la méditation',
  'Previous Readings': 'Lectures précédentes',
  'Previous Meditations': 'Méditations précédentes',
  'Quotes From Daily Meditations': 'Citations des méditations du jour',
  'Quote Feed': 'Fil des citations',
  'Hey Everyone': 'Salut à tous',
  'Birthday celebration': 'Célébration d’anniversaire',
  'Awards': 'Prix',
  'Awards Hub': 'Temple des prix',
  'Award Hub': 'Temple des prix',
  'Recent Awards': 'Prix récents',
  'All Awards': 'Tous les prix',
  'My Awards': 'Mes prix',
  'Award Categories': 'Catégories de prix',
  'Monthly Awards': 'Prix mensuels',
  'Runner-ups': 'Finalistes',
  'Winner': 'Vainqueur',
  'No awards yet': 'Aucun prix pour le moment',
  'No awards announced': 'Aucun prix annoncé',
  'Streak Board': 'Tableau des séries',
  'Denarii Board': 'Tableau des deniers',
  'Fig Board': 'Tableau des figues',
  'Valley Board': 'Tableau de la vallée',
  'Tent Board': 'Tableau des tentes',
  'Leaderboard': 'Classement',
  'Camp Stats': 'Statistiques du camp',
  'Marks': 'Marques',
  'Figs': 'Figues',
  'Rhudes': 'Rhudes',
  'Denarii': 'Deniers',
  'Streaks': 'Séries',
  'Current Streak': 'Série actuelle',
  'Longest Streak': 'Meilleure série',
  'Valid Days': 'Jours validés',
  'Misses': 'Absences',
  'Cumulative Misses': 'Absences cumulées',
  'Relics Owned': 'Reliques possédées',
  'Games Played': 'Parties jouées',
  'Quizzes Taken': 'Quiz passés',
  'Meditations': 'Méditations',
  'Member Since': 'Membre depuis',
  'Challenges': 'Défis',
  'Challenge Board': 'Tableau des défis',
  'Submitted Challenges': 'Défis soumis',
  'Review Evidence': 'Vérifier la preuve',
  'Approve': 'Approuver',
  'Reject': 'Rejeter',
  'Pending': 'En attente',
  'Approved': 'Approuvé',
  'Rejected': 'Rejeté',
  'Morning Call': 'Appel du matin',
  'Marked Present': 'Marqué présent',
  'Attendance': 'Présence',
  'Relics': 'Reliques',
  'Buy': 'Acheter',
  'Owned': 'Possédé',
  'Use': 'Utiliser',
  'Use Relic': 'Utiliser la relique',
  'Standard Trivia': 'Trivia standard',
  'Ludo Trivia': 'Ludo trivia',
  'Create Room': 'Créer une salle',
  'Join Room': 'Rejoindre la salle',
  'Waiting Room': 'Salle d’attente',
  'Launch Game': 'Lancer le jeu',
  'Forfeit': 'Abandonner',
  'Back to Arena': 'Retour à l’arène',
  'Right Answer': 'Bonne réponse',
  'Wrong Answer': 'Mauvaise réponse',
  'Your Turn': 'Votre tour',
  'Opponent Turn': 'Tour de l’adversaire',
  'Live Score': 'Score en direct',
  'You Won': 'Vous avez gagné',
  'You Lost': 'Vous avez perdu',
  'Notifications': 'Notifications',
  'Mark as read': 'Marquer comme lu',
  'Mark all as read': 'Tout marquer comme lu',
  'No notifications yet': 'Aucune notification pour le moment',
  'Comments': 'Commentaires',
  'Comment': 'Commenter',
  'Send': 'Envoyer',
  'Cancel': 'Annuler',
  'Delete': 'Supprimer',
  'Edit': 'Modifier',
  'Open': 'Ouvrir',
  'Close': 'Fermer',
  'Next': 'Suivant',
  'Prev': 'Précédent',
  'Previous': 'Précédent',
  'Continue': 'Continuer',
  'Loading': 'Chargement',
  'Search': 'Rechercher',
  'No results': 'Aucun résultat',
};

const PLACEHOLDER_FR: Record<string, string> = {
  'Your name': 'Votre nom',
  '+1234567890': '+1234567890',
  'MM/DD': 'MM/JJ',
  'Search': 'Rechercher',
  'Write a comment...': 'Écrivez un commentaire...',
  'Write a message...': 'Écrivez un message...',
  'Create password': 'Créer un mot de passe',
  'Confirm password': 'Confirmer le mot de passe',
};

const SKIP_SELECTOR = 'script,style,noscript,textarea,input,select,option,code,pre,[data-no-translate]';
const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Record<string, string>>();

function preserveSpacing(source: string, replacement: string) {
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  return `${leading}${replacement}${trailing}`;
}

function translateStaticText(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  if (TEXT_FR[compact]) return TEXT_FR[compact];
  const loading = compact.match(/^Loading (.+?)(?:\.{3}|…)$/);
  if (loading) return `Chargement de ${loading[1].toLowerCase()}...`;
  const posted = compact.match(/^Posted (.+)$/);
  if (posted) return `Publié ${posted[1]}`;
  const role = compact.match(/^Role: (.+)$/);
  if (role) return `Rôle : ${role[1]}`;
  return null;
}

function shouldSkip(node: Node) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest(SKIP_SELECTOR));
}

function translateTextNodes(root: ParentNode, useFrench: boolean) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  nodes.forEach((textNode) => {
    const original = originalText.get(textNode) ?? textNode.nodeValue ?? '';
    if (!originalText.has(textNode)) originalText.set(textNode, original);
    const next = useFrench ? translateStaticText(original) : original;
    if (next && textNode.nodeValue !== preserveSpacing(original, next)) {
      textNode.nodeValue = preserveSpacing(original, next);
    } else if (!useFrench && textNode.nodeValue !== original) {
      textNode.nodeValue = original;
    }
  });
}

function translateAttributes(root: ParentNode, useFrench: boolean) {
  const elements = Array.from(root.querySelectorAll('[placeholder],[title],[aria-label]'));
  elements.forEach((element) => {
    if (element.closest(SKIP_SELECTOR) && !element.matches('input,textarea')) return;
    const cache = originalAttrs.get(element) ?? {};
    ['placeholder', 'title', 'aria-label'].forEach((attr) => {
      const current = element.getAttribute(attr);
      if (current == null) return;
      if (!cache[attr]) cache[attr] = current;
      const original = cache[attr];
      const translated = PLACEHOLDER_FR[original] || TEXT_FR[original] || translateStaticText(original);
      const next = useFrench ? translated : original;
      if (next && current !== next) element.setAttribute(attr, next);
    });
    originalAttrs.set(element, cache);
  });
}

export function useFrenchUiTranslation(languageCode?: string | null) {
  useEffect(() => {
    if (typeof window === 'undefined' || !document.body) return;
    const useFrench = languageCode?.toLowerCase().startsWith('fr') === true;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        translateTextNodes(document.body, useFrench);
        translateAttributes(document.body, useFrench);
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label'],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [languageCode]);
}
