(() => {
  'use strict';

  const CONFIG = window.LAMEX_CONFIG || {};
  const CHANNEL_ID = CONFIG.channelId || '';
  const CHANNEL_URL = CONFIG.channelUrl || 'https://www.youtube.com/@lamextvlive';
  const PLAYLIST_ID = CONFIG.playlistId || '';
  const RSS_ENDPOINT = CONFIG.rssEndpoint || '/api/rss';
  const CACHE_KEY = `lamex-videos-${CHANNEL_ID}`;
  const CACHE_MINUTES = 15;

  const articles = [
    {
      id: 'debat-public',
      category: 'Politique',
      meta: 'DÉCRYPTAGE',
      title: 'Le débat public commence par une question simple : qui est concerné ?',
      excerpt: 'Comprendre les choix collectifs, c’est aussi écouter les citoyennes et citoyens qui en vivent les conséquences au quotidien.',
      image: '/assets/lamex-dakar.jpg',
      imageAlt: 'La vie quotidienne dans une rue de Dakar',
      author: 'La rédaction Lamex',
      readTime: '4 min de lecture',
      body: [
        'La politique ne se résume pas aux institutions ni aux grands rendez-vous électoraux. Elle se lit aussi dans les décisions qui transforment une école, un quartier, un marché ou un trajet quotidien.',
        'Pour suivre un débat avec recul, quelques réflexes aident : identifier les faits vérifiables, distinguer les propositions des résultats et donner une place aux personnes directement concernées. Cette méthode ne remplace pas le débat d’idées ; elle lui permet de s’appuyer sur des repères communs.',
        'À Lamex, nous voulons ouvrir cet espace de discussion avec des explications accessibles, des points de vue contradictoires et des questions posées au plus près du terrain. La conversation publique gagne à être précise, pluraliste et ancrée dans la vie réelle.'
      ]
    },
    {
      id: 'ville-quartiers',
      category: 'Société',
      meta: 'TERRITOIRES',
      title: 'Dakar se raconte aussi à l’échelle de ses quartiers',
      excerpt: 'Mobilité, entraide, initiatives locales : la ville se comprend d’abord à travers celles et ceux qui l’habitent.',
      image: '/assets/lamex-dakar.jpg',
      imageAlt: 'Dakar à l’heure dorée, entre circulation et vie de quartier',
      author: 'La rédaction Lamex',
      readTime: '3 min de lecture',
      body: [
        'Dakar est une métropole de contrastes et de rythmes. Derrière les grandes avenues, chaque quartier compose son propre quotidien : les déplacements, les petits commerces, les lieux de rencontre et les solidarités de proximité.',
        'Raconter la ville demande de prendre le temps de regarder ce qui se passe à hauteur de rue. Les associations, les artisans, les habitantes et les jeunes y font émerger des réponses concrètes aux besoins locaux.',
        'Cette série de portraits est une invitation à découvrir ces expériences et à faire entendre des réalités parfois éloignées des grands titres. Le territoire n’est pas un décor : il est le point de départ de l’histoire.'
      ]
    },
    {
      id: 'culture-kora',
      category: 'Culture',
      meta: 'CULTURE & CRÉATION',
      title: 'La kora, instrument de mémoire et de création vivante',
      excerpt: 'Entre transmission et nouvelles scènes, les artistes font dialoguer les héritages et les sons d’aujourd’hui.',
      image: '/assets/lamex-culture.jpg',
      imageAlt: 'Un musicien sénégalais joue de la kora sur scène',
      author: 'La rédaction Lamex',
      readTime: '5 min de lecture',
      body: [
        'La kora porte une histoire musicale riche, transmise de génération en génération. Sa sonorité singulière accompagne les récits, les cérémonies et les rencontres, tout en inspirant de nouvelles formes de création.',
        'Aujourd’hui, des artistes la font résonner dans des contextes variés : scène acoustique, arrangements contemporains, collaborations et expérimentations. La tradition reste vivante lorsqu’elle circule et se transforme sans perdre son lien avec les communautés qui la portent.',
        'À travers les voix des musiciennes et musiciens, Lamex souhaite raconter les parcours, les gestes et les idées qui font la vitalité culturelle du Sénégal.'
      ]
    }
  ];

  const demoVideos = [
    { title: 'Le direct et les rendez-vous de Lamex TV', thumb: '/assets/lamex-studio.jpg', label: 'LA CHAÎNE' },
    { title: 'Au plus près des réalités de Dakar', thumb: '/assets/lamex-dakar.jpg', label: 'SOCIÉTÉ' },
    { title: 'Culture : les voix et les talents du Sénégal', thumb: '/assets/lamex-culture.jpg', label: 'CULTURE' }
  ];

  const elements = {
    storyGrid: document.getElementById('story-grid'),
    videoGrid: document.getElementById('video-grid'),
    playerMedia: document.getElementById('player-media'),
    playerStage: document.getElementById('player-stage'),
    playerState: document.getElementById('player-state'),
    playerTitle: document.getElementById('player-title'),
    searchDialog: document.getElementById('search-dialog'),
    searchInput: document.getElementById('search-input'),
    searchResults: document.getElementById('search-results'),
    articleDialog: document.getElementById('article-dialog'),
    articleContent: document.getElementById('article-dialog-content'),
    membershipDialog: document.getElementById('membership-dialog'),
    toast: document.getElementById('toast')
  };

  let activeCategory = 'all';
  let toastTimer;
  let activeHls = null;
  let ytPlayer = null;
  let ytPlayerReady = false;
  let ytPlayerPromise = null;
  let currentPlayback = 'idle';
  let liveDetected = null;
  let liveVideoId = null;
  let liveStatusTimer = null;
  let liveEndedAt = 0;

  function foldText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createStoryCard(article, index) {
    const card = createElement('article', `story-card${index === 0 ? ' story-card--lead' : ''}`);
    card.dataset.category = article.category;
    card.dataset.search = foldText(`${article.category} ${article.meta} ${article.title} ${article.excerpt}`);

    const imageButton = createElement('button', 'story-image-button');
    imageButton.type = 'button';
    imageButton.dataset.openArticle = article.id;
    imageButton.setAttribute('aria-label', `Lire l'article : ${article.title}`);
    const image = document.createElement('img');
    image.src = article.image;
    image.alt = article.imageAlt;
    image.loading = index === 0 ? 'eager' : 'lazy';
    imageButton.append(image);
    imageButton.append(createElement('span', 'story-category', article.category));
    imageButton.append(createElement('span', 'story-number', String(index + 1).padStart(2, '0')));

    const content = createElement('div', 'story-content');
    const meta = createElement('p', 'story-meta');
    meta.append(createElement('span', '', article.meta));
    meta.append(createElement('span', 'story-meta-dot'));
    meta.append(createElement('span', '', article.readTime));

    const title = createElement('button', 'story-title-button', article.title);
    title.type = 'button';
    title.dataset.openArticle = article.id;
    const excerpt = createElement('p', 'story-excerpt', article.excerpt);
    const read = createElement('button', 'story-read', 'Lire le dossier');
    read.type = 'button';
    read.dataset.openArticle = article.id;
    read.append(createElement('span', '', '→'));

    content.append(meta, title, excerpt, read);
    card.append(imageButton, content);
    return card;
  }

  function renderArticles() {
    if (!elements.storyGrid) return;
    elements.storyGrid.replaceChildren(...articles.map(createStoryCard));
    applyArticleFilters();
  }

  function applyArticleFilters() {
    if (!elements.storyGrid) return;
    const cards = [...elements.storyGrid.querySelectorAll('.story-card')];
    let visibleCount = 0;
    cards.forEach((card) => {
      const visible = activeCategory === 'all' || card.dataset.category === activeCategory;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    let empty = elements.storyGrid.querySelector('.story-empty');
    if (!visibleCount) {
      if (!empty) {
        empty = createElement('p', 'story-empty', 'Aucun article ne correspond à cette recherche. Essayez un autre mot ou une autre rubrique.');
        elements.storyGrid.append(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  }

  function renderSearchResults(query) {
    if (!elements.searchResults) return;
    const value = String(query || '').trim();
    elements.searchResults.replaceChildren();
    if (value.length < 2) {
      elements.searchResults.append(createElement('p', 'search-empty', 'Saisissez au moins deux caractères pour rechercher.'));
      return;
    }
    const terms = foldText(value).split(/\s+/).filter(Boolean);
    const matches = articles.filter((article) => {
      const searchable = foldText(`${article.category} ${article.meta} ${article.title} ${article.excerpt} ${article.body.join(' ')}`);
      return terms.every((term) => searchable.includes(term));
    });
    if (!matches.length) {
      elements.searchResults.append(createElement('p', 'search-empty', 'Aucun article trouvé. Essayez un autre mot-clé.'));
      return;
    }
    matches.forEach((article) => {
      const result = createElement('button', 'search-result');
      result.type = 'button';
      result.dataset.openArticle = article.id;
      const copy = document.createElement('div');
      copy.append(createElement('span', '', article.category));
      copy.append(createElement('strong', '', article.title));
      result.append(copy, createElement('em', '', '→'));
      elements.searchResults.append(result);
    });
  }

  function renderArticleDetail(article) {
    if (!elements.articleContent) return;
    elements.articleContent.replaceChildren();
    const image = document.createElement('img');
    image.className = 'article-modal-image';
    image.src = article.image;
    image.alt = article.imageAlt;

    const body = createElement('div', 'article-modal-body');
    const meta = createElement('p', 'story-meta');
    meta.append(createElement('span', '', article.category));
    meta.append(createElement('span', 'story-meta-dot'));
    meta.append(createElement('span', '', article.readTime));
    const title = createElement('h2', '', article.title);
    title.id = 'article-dialog-title';
    const deck = createElement('p', 'article-modal-deck', article.excerpt);
    const byline = createElement('div', 'article-modal-byline', `${article.author} · Article de démonstration à valider par la rédaction`);
    const text = createElement('div', 'article-modal-text');
    article.body.forEach((paragraph) => text.append(createElement('p', '', paragraph)));
    body.append(meta, title, deck, byline, text);
    elements.articleContent.append(image, body);
  }

  function openArticle(id) {
    const article = articles.find((entry) => entry.id === id);
    if (!article || !elements.articleDialog) return;
    renderArticleDetail(article);
    document.body.classList.add('dialog-open');
    if (typeof elements.articleDialog.showModal === 'function') {
      elements.articleDialog.showModal();
    } else {
      elements.articleDialog.setAttribute('open', '');
    }
  }

  function formatDate(value) {
    if (!value) return 'RÉCENT';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'RÉCENT';
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date).toUpperCase();
  }

  function createVideoTile(video, index, isDemo = false) {
    const tile = document.createElement('a');
    tile.className = 'video-tile';
    tile.href = isDemo ? `${CHANNEL_URL}/videos` : '#direct';
    if (!isDemo) {
      tile.dataset.videoId = video.id;
    } else {
      tile.target = '_blank';
      tile.rel = 'noopener noreferrer';
    }
    tile.setAttribute('aria-label', isDemo ? `Voir les vidéos Lamex TV sur YouTube : ${video.title}` : `Lire la vidéo : ${video.title}`);

    const thumb = createElement('div', 'video-thumb');
    const image = document.createElement('img');
    image.src = video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`;
    image.alt = '';
    image.loading = 'lazy';
    image.onerror = () => { image.src = '/assets/lamex-studio.jpg'; };
    thumb.append(image);
    thumb.append(createElement('span', 'video-badge', isDemo ? 'APERÇU' : 'LAMEX TV'));
    thumb.append(createElement('span', 'video-play-icon', '▶'));

    const info = createElement('div', 'video-info');
    info.append(createElement('p', 'video-title', video.title || 'Vidéo Lamex TV'));
    info.append(createElement('p', 'video-date', isDemo ? video.label : formatDate(video.published)));
    tile.append(thumb, info);
    return tile;
  }

  function renderVideos(videos) {
    if (!elements.videoGrid) return;
    const safeVideos = videos.filter((video) => video && /^[A-Za-z0-9_-]{6,20}$/.test(video.id || '')).slice(0, 3);
    if (!safeVideos.length) throw new Error('Aucune vidéo exploitable dans le flux.');
    elements.videoGrid.replaceChildren(...safeVideos.map((video, index) => createVideoTile(video, index, false)));
  }

  function renderVideoFallback() {
    if (!elements.videoGrid) return;
    const note = createElement('p', 'video-demo-note', 'Aperçu local : après déploiement sur Netlify, les dernières vidéos seront chargées automatiquement depuis YouTube.');
    const tiles = demoVideos.map((video, index) => createVideoTile(video, index, true));
    elements.videoGrid.replaceChildren(...tiles, note);
  }

  function parseRss(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Le flux YouTube est illisible.');
    const entries = [...xml.getElementsByTagNameNS('*', 'entry')];
    return entries.map((entry) => {
      const getText = (localName) => {
        const found = entry.getElementsByTagNameNS('*', localName)[0];
        return found ? found.textContent.trim() : '';
      };
      const thumbNode = entry.getElementsByTagNameNS('*', 'thumbnail')[0];
      const videoId = getText('videoId');
      return {
        id: videoId,
        title: getText('title') || 'Vidéo Lamex TV',
        published: getText('published'),
        thumb: thumbNode ? thumbNode.getAttribute('url') : ''
      };
    }).filter((video) => /^[A-Za-z0-9_-]{6,20}$/.test(video.id));
  }

  function getCachedVideos() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (!cached || (Date.now() - cached.time) / 60000 > CACHE_MINUTES) return null;
      return cached.videos;
    } catch (_) {
      return null;
    }
  }

  function fetchVideos() {
    if (!elements.videoGrid) return;
    const cached = getCachedVideos();
    if (cached && cached.length) {
      renderVideos(cached);
      return;
    }
    if (!CHANNEL_ID || !CHANNEL_ID.startsWith('UC')) {
      renderVideoFallback();
      return;
    }

    const url = `${RSS_ENDPOINT}?channelId=${encodeURIComponent(CHANNEL_ID)}`;
    fetch(url, { headers: { Accept: 'application/xml, text/xml' } })
      .then((response) => {
        if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
        return response.text();
      })
      .then(parseRss)
      .then((videos) => {
        if (!videos.length) throw new Error('Le flux ne contient pas encore de vidéo.');
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), videos })); } catch (_) { /* cache facultatif */ }
        renderVideos(videos);
      })
      .catch((error) => {
        console.info('Grille YouTube en mode aperçu :', error.message);
        renderVideoFallback();
      });
  }

  function setPlayerStatus(status, title) {
    if (elements.playerState) {
      elements.playerState.textContent = status;
      elements.playerState.classList.toggle('is-playing', status === 'EN LECTURE' || status === 'REPLAY');
    }
    if (elements.playerTitle && title) elements.playerTitle.textContent = title;
  }

  function destroyYoutubePlayer() {
    if (ytPlayer) {
      try { ytPlayer.destroy(); } catch (_) { /* le lecteur peut déjà être démonté */ }
    }
    ytPlayer = null;
    ytPlayerReady = false;
    ytPlayerPromise = null;
  }

  function clearPlayer() {
    if (activeHls) {
      try { activeHls.destroy(); } catch (_) { /* le lecteur peut déjà être démonté */ }
      activeHls = null;
    }
    destroyYoutubePlayer();
    if (!elements.playerMedia) return;
    elements.playerMedia.querySelectorAll('iframe, video, #lamex-youtube-mount').forEach((node) => node.remove());
    if (elements.playerStage) elements.playerStage.dataset.playing = 'false';
  }

  function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (window.__lamexYouTubeApiPromise) return window.__lamexYouTubeApiPromise;
    window.__lamexYouTubeApiPromise = new Promise((resolve, reject) => {
      const previousCallback = window.onYouTubeIframeAPIReady;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Le lecteur YouTube n’a pas pu être chargé.'));
      }, 12000);
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === 'function') previousCallback();
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('Connexion à YouTube impossible.'));
        };
        document.head.append(script);
      }
    });
    return window.__lamexYouTubeApiPromise;
  }

  function onYoutubeStateChange(event) {
    if (!event || event.data !== 0) return;
    if (currentPlayback === 'video' || currentPlayback === 'live') {
      if (currentPlayback === 'live') {
        liveDetected = false;
        liveVideoId = null;
        liveEndedAt = Date.now();
      }
      startYoutubePlaylist(false);
    }
  }

  function onYoutubeError(event) {
    console.warn('Lamex TV — erreur du lecteur YouTube :', event && event.data);
    if (currentPlayback === 'video' || currentPlayback === 'live') {
      if (currentPlayback === 'live') {
        liveDetected = false;
        liveVideoId = null;
        liveEndedAt = Date.now();
      }
      startYoutubePlaylist(false);
    } else if (currentPlayback === 'playlist') {
      setPlayerStatus('INDISPONIBLE', 'Playlist indisponible — vérifiez son identifiant');
      showToast('Vérifiez l’identifiant de la playlist dans config.js.');
    }
  }

  async function ensureYoutubePlayer() {
    if (ytPlayer && ytPlayerReady) return ytPlayer;
    if (ytPlayerPromise) return ytPlayerPromise;

    ytPlayerPromise = loadYouTubeAPI().then((YT) => new Promise((resolve, reject) => {
      if (!elements.playerMedia) {
        reject(new Error('Zone du lecteur introuvable.'));
        return;
      }
      if (ytPlayer && ytPlayerReady) {
        resolve(ytPlayer);
        return;
      }
      if (activeHls) {
        try { activeHls.destroy(); } catch (_) { /* ignorer */ }
        activeHls = null;
      }
      elements.playerMedia.querySelectorAll('iframe, video, #lamex-youtube-mount').forEach((node) => node.remove());
      const mount = document.createElement('div');
      mount.id = 'lamex-youtube-mount';
      elements.playerMedia.append(mount);
      if (elements.playerStage) elements.playerStage.dataset.playing = 'true';

      const readyTimeout = window.setTimeout(() => {
        if (ytPlayerReady) return;
        reject(new Error('Le lecteur YouTube met trop de temps à répondre.'));
        destroyYoutubePlayer();
        if (elements.playerStage) elements.playerStage.dataset.playing = 'false';
      }, 14000);

      ytPlayer = new YT.Player(mount.id, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          mute: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 1,
          fs: 1,
          iv_load_policy: 3
        },
        events: {
          onReady: (event) => {
            ytPlayer = event.target;
            ytPlayerReady = true;
            window.clearTimeout(readyTimeout);
            resolve(ytPlayer);
          },
          onStateChange: onYoutubeStateChange,
          onError: onYoutubeError
        }
      });
    })).catch((error) => {
      ytPlayerPromise = null;
      throw error;
    });

    return ytPlayerPromise;
  }

  function scrollToPlayer() {
    const player = document.getElementById('direct');
    if (player) player.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function playYoutubeVideo(videoId, mode, title, shouldScroll = true) {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || '')) return;
    currentPlayback = mode;
    setPlayerStatus(mode === 'live' ? 'EN LECTURE' : 'REPLAY', title || 'Lamex TV');
    if (shouldScroll) scrollToPlayer();
    try {
      const player = await ensureYoutubePlayer();
      if (typeof player.mute === 'function') player.mute();
      player.loadVideoById({ videoId, startSeconds: 0 });
    } catch (error) {
      currentPlayback = 'idle';
      setPlayerStatus('WEB TV', 'Votre rendez-vous avec le Sénégal');
      showToast(error.message || 'Impossible de démarrer la vidéo YouTube.');
    }
  }

  function startYoutubeLive(shouldScroll = true) {
    if (!CHANNEL_ID) {
      showToast('Ajoutez l’identifiant de chaîne YouTube dans config.js.');
      return;
    }
    if (liveDetected === false) {
      startYoutubePlaylist(shouldScroll);
      return;
    }
    if (liveVideoId) {
      playYoutubeVideo(liveVideoId, 'live', 'Lamex TV — direct', shouldScroll);
      return;
    }

    // Fallback officiel YouTube : utile avant que la vérification oEmbed renvoie un identifiant.
    currentPlayback = 'live';
    clearPlayer();
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(CHANNEL_ID)}&autoplay=1&mute=1&rel=0&playsinline=1`;
    iframe.title = 'Lamex TV — diffusion en direct';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    elements.playerMedia.append(iframe);
    if (elements.playerStage) elements.playerStage.dataset.playing = 'true';
    setPlayerStatus('EN LECTURE', 'Lamex TV — direct');
    if (shouldScroll) scrollToPlayer();
  }

  async function startYoutubePlaylist(shouldScroll = true) {
    if (!PLAYLIST_ID || !PLAYLIST_ID.startsWith('PL')) {
      showToast('Renseignez l’identifiant complet de la playlist YouTube dans config.js.');
      return;
    }
    currentPlayback = 'playlist';
    setPlayerStatus('REPLAY', 'Lamex TV — vos programmes');
    if (shouldScroll) scrollToPlayer();
    try {
      const player = await ensureYoutubePlayer();
      player.loadPlaylist({ list: PLAYLIST_ID, listType: 'playlist', index: 0, startSeconds: 0 });
      player.setLoop(true);
    } catch (error) {
      currentPlayback = 'idle';
      setPlayerStatus('WEB TV', 'Votre rendez-vous avec le Sénégal');
      showToast(error.message || 'Impossible de charger la playlist YouTube.');
    }
  }

  function startYoutubeVideo(videoId, title) {
    playYoutubeVideo(videoId, 'video', title || 'Replay Lamex TV');
  }

  async function checkLiveStatus() {
    if (!CHANNEL_ID || CONFIG.streamMode === 'hls' || !CONFIG.liveEndpoint) return;
    try {
      const response = await fetch(`${CONFIG.liveEndpoint}?channelId=${encodeURIComponent(CHANNEL_ID)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const wasLive = liveDetected;
      liveDetected = Boolean(data && data.isLive);
      liveVideoId = liveDetected && /^[A-Za-z0-9_-]{6,20}$/.test(data.videoId || '') ? data.videoId : null;
      if (!liveDetected) liveEndedAt = 0;
      const autoSwitchAllowed = !liveEndedAt || Date.now() - liveEndedAt > 180000;

      if (liveDetected && currentPlayback === 'idle') {
        setPlayerStatus('DIRECT DISPONIBLE', 'Le direct Lamex TV est disponible');
      } else if (!liveDetected && currentPlayback === 'idle') {
        setPlayerStatus('WEB TV', 'Votre rendez-vous avec le Sénégal');
      }

      if (liveDetected && currentPlayback === 'playlist' && autoSwitchAllowed) {
        if (liveVideoId) playYoutubeVideo(liveVideoId, 'live', data.title || 'Lamex TV — direct', false);
        else startYoutubeLive(false);
      } else if (liveDetected && currentPlayback === 'live' && liveVideoId && wasLive !== true && autoSwitchAllowed) {
        playYoutubeVideo(liveVideoId, 'live', data.title || 'Lamex TV — direct', false);
      } else if (!liveDetected && currentPlayback === 'live') {
        liveVideoId = null;
        startYoutubePlaylist(false);
      }
    } catch (_) {
      // L’aperçu statique ou un incident réseau ne doit pas bloquer la lecture manuelle.
    }
  }

  function startLiveMonitoring() {
    if (CONFIG.streamMode === 'hls') return;
    checkLiveStatus();
    const interval = Math.max(60, Number(CONFIG.liveCheckSeconds) || 90) * 1000;
    if (liveStatusTimer) window.clearInterval(liveStatusTimer);
    liveStatusTimer = window.setInterval(checkLiveStatus, interval);
  }

  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (window.__lamexHlsPromise) return window.__lamexHlsPromise;
    window.__lamexHlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
      script.async = true;
      script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('hls.js non disponible'));
      script.onerror = () => reject(new Error('Impossible de charger le lecteur HLS'));
      document.head.append(script);
    });
    return window.__lamexHlsPromise;
  }

  async function startHlsStream() {
    const playbackUrl = CONFIG.hlsPlaybackUrl;
    if (!playbackUrl) {
      showToast('Ajoutez une URL de lecture HLS dans config.js après avoir configuré votre service de diffusion.');
      return;
    }
    currentPlayback = 'hls';
    clearPlayer();
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-label', 'Diffusion en direct Lamex TV');
    elements.playerMedia.append(video);
    if (elements.playerStage) elements.playerStage.dataset.playing = 'true';
    setPlayerStatus('CONNEXION', 'Lamex TV — connexion au flux');
    scrollToPlayer();

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl;
      video.play().catch(() => showToast('Touchez la vidéo pour démarrer la diffusion.'));
      setPlayerStatus('EN LECTURE', 'Lamex TV — direct');
      return;
    }
    try {
      const Hls = await loadHlsScript();
      if (!Hls.isSupported()) throw new Error('Ce navigateur ne prend pas en charge HLS.');
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      activeHls = hls;
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => showToast('Touchez la vidéo pour démarrer la diffusion.')));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data && data.fatal) {
          setPlayerStatus('INDISPONIBLE', 'Flux momentanément indisponible');
          showToast('Le flux HLS est indisponible. Vérifiez l’URL de lecture et l’ingest RTMP.');
        }
      });
      video.dataset.hlsAttached = 'true';
      setPlayerStatus('EN LECTURE', 'Lamex TV — direct');
    } catch (error) {
      clearPlayer();
      setPlayerStatus('WEB TV', 'Votre rendez-vous avec le Sénégal');
      showToast(error.message || 'Impossible de lire le flux HLS.');
    }
  }

  function startStream() {
    if (CONFIG.streamMode === 'hls') {
      startHlsStream();
    } else {
      startYoutubeLive();
    }
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 3800);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    document.body.classList.add('dialog-open');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function updateClock() {
    const clock = document.getElementById('local-clock');
    if (!clock) return;
    try {
      clock.textContent = new Intl.DateTimeFormat('fr-SN', {
        timeZone: 'Africa/Dakar', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
    } catch (_) {
      clock.textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    }
  }

  function bindInteractions() {
    document.querySelectorAll('[data-start-stream]').forEach((button) => button.addEventListener('click', startStream));
    document.querySelectorAll('[data-start-playlist]').forEach((button) => button.addEventListener('click', startYoutubePlaylist));

    if (elements.storyGrid) {
      elements.storyGrid.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-open-article]');
        if (trigger) openArticle(trigger.dataset.openArticle);
      });
    }

    if (elements.videoGrid) {
      elements.videoGrid.addEventListener('click', (event) => {
        const tile = event.target.closest('[data-video-id]');
        if (!tile) return;
        event.preventDefault();
        startYoutubeVideo(tile.dataset.videoId, tile.querySelector('.video-title')?.textContent || 'Replay Lamex TV');
      });
    }

    document.querySelectorAll('.topic-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        activeCategory = chip.dataset.filter || 'all';
        document.querySelectorAll('.topic-chip').forEach((other) => {
          const active = other === chip;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        applyArticleFilters();
      });
    });

    const searchButton = document.getElementById('open-search');
    if (searchButton) searchButton.addEventListener('click', () => {
      openDialog(elements.searchDialog);
      window.setTimeout(() => elements.searchInput && elements.searchInput.focus(), 0);
    });
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', () => renderSearchResults(elements.searchInput.value));
      if (elements.searchDialog) {
        elements.searchDialog.addEventListener('close', () => {
          elements.searchInput.value = '';
          renderSearchResults('');
        });
        elements.searchDialog.addEventListener('click', (event) => {
          if (event.target === elements.searchDialog) elements.searchDialog.close();
        });
      }
    }
    if (elements.searchResults) {
      elements.searchResults.addEventListener('click', (event) => {
        const result = event.target.closest('[data-open-article]');
        if (!result) return;
        const articleId = result.dataset.openArticle;
        if (elements.searchDialog && elements.searchDialog.open) elements.searchDialog.close();
        openArticle(articleId);
      });
    }

    document.querySelectorAll('[data-open-membership]').forEach((button) => button.addEventListener('click', () => openDialog(elements.membershipDialog)));

    document.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
      dialog.addEventListener('cancel', () => document.body.classList.remove('dialog-open'));
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    const menuButton = document.getElementById('menu-toggle');
    const nav = document.getElementById('primary-nav');
    if (menuButton && nav) {
      menuButton.addEventListener('click', () => {
        const expanded = menuButton.getAttribute('aria-expanded') === 'true';
        menuButton.setAttribute('aria-expanded', String(!expanded));
        menuButton.setAttribute('aria-label', expanded ? 'Ouvrir le menu' : 'Fermer le menu');
        nav.classList.toggle('is-open', !expanded);
      });
      nav.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
          menuButton.setAttribute('aria-expanded', 'false');
          menuButton.setAttribute('aria-label', 'Ouvrir le menu');
          nav.classList.remove('is-open');
        }
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 760) {
          menuButton.setAttribute('aria-expanded', 'false');
          menuButton.setAttribute('aria-label', 'Ouvrir le menu');
          nav.classList.remove('is-open');
        }
      });
    }

    const newsletter = document.getElementById('newsletter-form');
    if (newsletter) newsletter.addEventListener('submit', (event) => {
      event.preventDefault();
      showToast('La lettre Lamex sera activée après raccordement du service d’envoi.');
      newsletter.reset();
    });

    document.querySelectorAll('.header-cta, .hero-actions .button').forEach((button) => {
      if (button.tagName === 'A') return;
      button.addEventListener('click', () => {
        if (button.hasAttribute('data-start-stream')) return;
        startStream();
      });
    });
  }

  function init() {
    renderArticles();
    fetchVideos();
    bindInteractions();
    startLiveMonitoring();
    updateClock();
    window.setInterval(updateClock, 30_000);
    const year = document.getElementById('current-year');
    if (year) year.textContent = String(new Date().getFullYear());
    const channelLinks = document.querySelectorAll('a[href="https://www.youtube.com/@lamextvlive"]');
    channelLinks.forEach((link) => { link.href = CHANNEL_URL; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
