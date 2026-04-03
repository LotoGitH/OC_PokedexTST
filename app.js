/* ============================================================
   Pokédex – app.js
   Vanilla JS + PokeAPI v2 | No frameworks
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────
const API       = 'https://pokeapi.co/api/v2';
const TOTAL     = 151;

// ── State ──────────────────────────────────────────────────
const state = {
  pokemonList:    [],   // [{ name, url }]
  cache:          {},   // id → full detail object
  selectedId:     null,
  listElements:   {},   // id → DOM li element
};

// ── DOM refs ───────────────────────────────────────────────
const listEl    = document.getElementById('pokemon-list');
const detailEl  = document.getElementById('pokemon-detail');
const searchEl  = document.getElementById('search-input');

// ══════════════════════════════════════════════════════════
//  API helpers
// ══════════════════════════════════════════════════════════

/**
 * Generic fetch wrapper — throws on non-OK status.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${url}`);
  return res.json();
}

/**
 * Fetch first 151 Pokémon names + URLs.
 * @returns {Promise<Array>}
 */
async function fetchPokemonList() {
  const data = await apiFetch(`${API}/pokemon?limit=${TOTAL}&offset=0`);
  return data.results; // [{ name, url }]
}

/**
 * Fetch full Pokémon data by ID (name + sprites + stats + types).
 * Results are cached to avoid repeat requests.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function fetchPokemonDetail(id) {
  if (state.cache[id]) return state.cache[id];
  const data = await apiFetch(`${API}/pokemon/${id}`);
  state.cache[id] = data;
  return data;
}

/**
 * Fetch species data (flavor text, evolution chain URL).
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function fetchSpecies(id) {
  return apiFetch(`${API}/pokemon-species/${id}`);
}

/**
 * Fetch full evolution chain from its URL.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchEvolutionChain(url) {
  return apiFetch(url);
}

/**
 * Fetch type data to get damage relations.
 * @param {string} typeName
 * @returns {Promise<object>}
 */
async function fetchTypeData(typeName) {
  return apiFetch(`${API}/type/${typeName}`);
}

// ══════════════════════════════════════════════════════════
//  List rendering
// ══════════════════════════════════════════════════════════

/**
 * Build and insert the sidebar list from state.pokemonList.
 */
function renderList() {
  listEl.innerHTML = '';

  state.pokemonList.forEach((poke, index) => {
    const id  = index + 1;
    const img = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

    const item = document.createElement('div');
    item.className   = 'poke-item';
    item.tabIndex    = 0;
    item.role        = 'option';
    item.dataset.id  = id;
    item.setAttribute('aria-label', poke.name);
    item.innerHTML   = `
      <span class="poke-number">#${String(id).padStart(3, '0')}</span>
      <img class="poke-sprite" src="${img}" alt="${poke.name}" loading="lazy" />
      <span class="poke-name">${poke.name}</span>
    `;

    // Click handler
    item.addEventListener('click', () => selectPokemon(id));

    // Keyboard navigation (Enter / Space to select, arrows to move)
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectPokemon(id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        item.nextElementSibling?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        item.previousElementSibling?.focus();
      }
    });

    state.listElements[id] = item;
    listEl.appendChild(item);
  });
}

/**
 * Filter the list by search term.
 * @param {string} query
 */
function filterList(query) {
  const q = query.toLowerCase().trim();
  Object.entries(state.listElements).forEach(([id, el]) => {
    const name = state.pokemonList[id - 1]?.name ?? '';
    const num  = String(id).padStart(3, '0');
    el.style.display = (name.includes(q) || num.includes(q)) ? '' : 'none';
  });
}

// ══════════════════════════════════════════════════════════
//  Detail rendering
// ══════════════════════════════════════════════════════════

/**
 * Show a loading placeholder in the detail pane.
 */
function renderDetailLoader() {
  detailEl.innerHTML = `
    <div class="detail-loading">
      <div class="loader-spinner"></div>
      <p>Loading…</p>
    </div>
  `;
}

/**
 * Highlight active item in the sidebar.
 * @param {number} id
 */
function setActiveItem(id) {
  if (state.selectedId && state.listElements[state.selectedId]) {
    state.listElements[state.selectedId].classList.remove('is-active');
  }
  state.selectedId = id;
  const el = state.listElements[id];
  if (el) {
    el.classList.add('is-active');
    el.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Build a type badge element.
 * @param {string} typeName
 * @returns {HTMLElement}
 */
function makeTypeBadge(typeName) {
  const span = document.createElement('span');
  span.className = `type-badge type-${typeName}`;
  span.textContent = typeName;
  return span;
}

/**
 * Extract a flat list of Pokémon from an evolution chain node.
 * @param {object} node  - chain node from API
 * @returns {Array<{name, id}>}
 */
function parseEvolutionChain(node) {
  const result = [];
  const traverse = (n) => {
    if (!n) return;
    const urlParts = n.species.url.split('/').filter(Boolean);
    result.push({ name: n.species.name, id: urlParts[urlParts.length - 1] });
    n.evolves_to.forEach(traverse);
  };
  traverse(node);
  return result;
}

/**
 * Compute net weaknesses from all types of a Pokémon.
 * Returns types with effective multiplier > 1.
 * @param {Array<string>} typeNames
 * @returns {Promise<Array<string>>}
 */
async function computeWeaknesses(typeNames) {
  const multipliers = {};

  await Promise.all(typeNames.map(async (typeName) => {
    const typeData = await fetchTypeData(typeName);
    const { damage_relations } = typeData;

    damage_relations.double_damage_from.forEach(t => {
      multipliers[t.name] = (multipliers[t.name] || 1) * 2;
    });
    damage_relations.half_damage_from.forEach(t => {
      multipliers[t.name] = (multipliers[t.name] || 1) * 0.5;
    });
    damage_relations.no_damage_from.forEach(t => {
      multipliers[t.name] = 0;
    });
  }));

  return Object.entries(multipliers)
    .filter(([, v]) => v > 1)
    .map(([k]) => k)
    .sort();
}

/**
 * Get flavor text in English (or Spanish fallback).
 * @param {Array} entries
 * @returns {string}
 */
function getFlavorText(entries) {
  const en = entries.find(e => e.language.name === 'en');
  const es = entries.find(e => e.language.name === 'es');
  const raw = (en || es)?.flavor_text ?? 'No description available.';
  // API returns text with weird whitespace / form feeds
  return raw.replace(/[\f\n\r\t\v]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Stat label mapping (short → readable).
 */
const STAT_LABELS = {
  hp:               'HP',
  attack:           'Attack',
  defense:          'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense':'Sp. Def',
  speed:            'Speed',
};

/**
 * Render full detail panel for a given Pokémon.
 * @param {number} id
 */
async function renderDetail(id) {
  renderDetailLoader();
  setActiveItem(id);

  try {
    // ── Fetch core data in parallel ──────────────────────
    const [pokemon, species] = await Promise.all([
      fetchPokemonDetail(id),
      fetchSpecies(id),
    ]);

    const typeNames       = pokemon.types.map(t => t.type.name);
    const flavorText      = getFlavorText(species.flavor_text_entries);

    // ── Fetch weaknesses + evolution chain in parallel ───
    const [weaknesses, evoChainData] = await Promise.all([
      computeWeaknesses(typeNames),
      fetchEvolutionChain(species.evolution_chain.url),
    ]);

    const evoSteps = parseEvolutionChain(evoChainData.chain);

    // ── Image ────────────────────────────────────────────
    const imgUrl =
      pokemon.sprites.other?.['official-artwork']?.front_default ||
      pokemon.sprites.front_default;

    // ── Build HTML ───────────────────────────────────────

    // Type badges
    const typeBadgesHTML = typeNames
      .map(t => `<span class="type-badge type-${t}">${t}</span>`)
      .join(' ');

    // Stat bars (max stat considered 255)
    const statsHTML = pokemon.stats.map(s => {
      const label = STAT_LABELS[s.stat.name] || s.stat.name;
      const val   = s.base_stat;
      const pct   = Math.min(100, Math.round((val / 255) * 100));
      return `
        <div class="stat-row">
          <span class="stat-label">${label}</span>
          <span class="stat-value">${val}</span>
          <div class="stat-bar-bg">
            <div class="stat-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    // Weakness badges
    const weakHTML = weaknesses.length
      ? weaknesses.map(w => `<span class="type-badge type-${w}">${w}</span>`).join(' ')
      : '<span class="has-text-grey">None in Kanto types</span>';

    // Evolution chain
    const evoHTML = evoSteps.map((step, i) => {
      const arrow = i < evoSteps.length - 1 ? '<span class="evo-arrow">▶</span>' : '';
      const sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${step.id}.png`;
      return `
        <div class="evo-step" data-evo-id="${step.id}" tabindex="0" title="${step.name}">
          <img src="${sprite}" alt="${step.name}" />
          <span>#${String(step.id).padStart(3,'0')} ${step.name}</span>
        </div>
        ${arrow}`;
    }).join('');

    // ── Height / Weight ───────────────────────────────────
    const heightM  = (pokemon.height  / 10).toFixed(1);
    const weightKg = (pokemon.weight / 10).toFixed(1);

    // ── Inject into DOM ──────────────────────────────────
    detailEl.innerHTML = `
      <div class="detail-card">

        <!-- Header: image + name + types -->
        <div class="detail-header">
          <img class="detail-image" src="${imgUrl}" alt="${pokemon.name}" />
          <div>
            <p class="detail-number">#${String(id).padStart(3, '0')}</p>
            <p class="detail-name">${pokemon.name}</p>
            <div style="margin-top:8px">${typeBadgesHTML}</div>
            <p style="margin-top:10px;color:#888;font-size:0.82rem">
              📏 ${heightM} m &nbsp;|&nbsp; ⚖️ ${weightKg} kg
            </p>
          </div>
        </div>

        <!-- Description -->
        <p class="section-title">Description</p>
        <p class="poke-description">${flavorText}</p>

        <!-- Base Stats -->
        <p class="section-title">Base Stats</p>
        ${statsHTML}

        <!-- Weaknesses -->
        <p class="section-title">Weaknesses</p>
        <div class="weakness-grid">${weakHTML}</div>

        <!-- Evolution Chain -->
        <p class="section-title">Evolution Chain</p>
        <div class="evo-chain">${evoHTML}</div>

      </div>
    `;

    // ── Wire up evo-step clicks ─────────────────────────
    detailEl.querySelectorAll('.evo-step').forEach(el => {
      const evoId = Number(el.dataset.evoId);
      el.addEventListener('click', () => selectPokemon(evoId));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') selectPokemon(evoId);
      });
    });

  } catch (err) {
    detailEl.innerHTML = `
      <div class="detail-card">
        <p class="has-text-danger">⚠️ Failed to load Pokémon data.</p>
        <p class="has-text-grey is-size-7">${err.message}</p>
      </div>`;
    console.error('renderDetail error:', err);
  }
}

// ══════════════════════════════════════════════════════════
//  Selection
// ══════════════════════════════════════════════════════════

/**
 * Select a Pokémon by ID — updates sidebar highlight + detail pane.
 * @param {number} id
 */
function selectPokemon(id) {
  if (id < 1 || id > TOTAL) return;
  renderDetail(id);
}

// ══════════════════════════════════════════════════════════
//  Init
// ══════════════════════════════════════════════════════════

async function init() {
  try {
    // 1. Fetch list
    state.pokemonList = await fetchPokemonList();

    // 2. Render sidebar list
    renderList();

    // 3. Auto-select #1 Bulbasaur
    selectPokemon(1);

  } catch (err) {
    listEl.innerHTML = `
      <div class="has-text-danger px-4 py-4">
        <p>⚠️ Could not load Pokémon list.</p>
        <p class="is-size-7">${err.message}</p>
      </div>`;
    console.error('init error:', err);
  }
}

// ── Search listener ────────────────────────────────────────
searchEl.addEventListener('input', () => filterList(searchEl.value));

// ── Kick off ───────────────────────────────────────────────
init();
