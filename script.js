const SPORTSDB_KEY = "123";
let serieBId = null; // descoberto em runtime via /v1/campeonatos

let currentTable = null;
let apiKey = localStorage.getItem("apiFutebolKey") || "";

const statusLine = document.getElementById("statusLine");
const tableBody = document.getElementById("tableBody");
const legendBox = document.getElementById("legendBox");
const keyStatus = document.getElementById("keyStatus");
const apiKeyInput = document.getElementById("apiKeyInput");
const scorersArea = document.getElementById("scorersArea");

if (apiKey) apiKeyInput.value = apiKey;

function authHeaders() {
  return { Authorization: `Bearer ${apiKey}` };
}

// A resposta de /tabela vem aninhada por fase/grupo. Essa função desce recursivamente
// até achar o primeiro array — funciona pro Brasileirão, que só tem uma fase e um grupo.
function extractTableArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const found = extractTableArray(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getSerieBId() {
  if (serieBId) return serieBId;
  const res = await fetch("https://api.api-futebol.com.br/v1/campeonatos", { headers: authHeaders() });
  if (!res.ok) throw new Error("não foi possível listar os campeonatos");
  const list = await res.json();
  const match = (Array.isArray(list) ? list : list.data || []).find(c =>
    (c.nome_popular || c.nome || "").toLowerCase().includes("série b") ||
    (c.nome_popular || c.nome || "").toLowerCase().includes("serie b")
  );
  if (!match) throw new Error("Série B não encontrada na lista de campeonatos");
  serieBId = match.campeonato_id;
  return serieBId;
}

function getZone(rank, total) {
  if (rank <= 4) return { label: "Acesso à Série A", cls: "z-acesso" };
  if (rank > total - 4) return { label: "Rebaixamento à Série C", cls: "z-reb" };
  return null;
}

function renderLegend() {
  const items = [["z-acesso","Acesso à Série A"],["z-reb","Rebaixamento à Série C"]];
  legendBox.innerHTML = items.map(([cls,label]) =>
    `<span><span class="dot ${cls}"></span>${label}</span>`).join("");
}

async function loadStandings() {
  const campId = await getSerieBId();
  const res = await fetch(`https://api.api-futebol.com.br/v1/campeonatos/${campId}/tabela`, { headers: authHeaders() });
  if (!res.ok) throw new Error(res.status === 401 ? "chave inválida" : "falha ao buscar a tabela");
  const data = await res.json();
  const arr = extractTableArray(data);
  if (!arr) throw new Error("formato de tabela inesperado");
  return arr;
}

function renderTable() {
  renderLegend();
  if (!currentTable || !currentTable.length) {
    tableBody.innerHTML = `<tr><td colspan="11" style="padding:28px;color:var(--chalk-dim);">Sem dados carregados ainda.</td></tr>`;
    return;
  }
  const total = currentTable.length;
  tableBody.innerHTML = currentTable.map(row => {
    const rank = row.posicao;
    const zone = getZone(rank, total);
    const stripe = zone ? `<span class="zone-stripe ${zone.cls}" title="${zone.label}"></span>` : "";
    const t = row.time || {};
    return `
      <tr class="row">
        <td>${stripe}</td>
        <td class="rank-num">${rank}</td>
        <td class="team-cell">
          <img class="badge" src="${t.escudo || ''}" alt="${t.nome_popular || ''}" data-team-name="${t.nome_popular || ''}">
          <span class="team-name">${t.nome_popular || ''}</span>
        </td>
        <td><strong>${row.pontos}</strong></td>
        <td>${row.jogos}</td>
        <td>${row.vitorias}</td>
        <td>${row.empates}</td>
        <td>${row.derrotas}</td>
        <td>${row.gols_pro}</td>
        <td>${row.gols_contra}</td>
        <td>${row.saldo_gols}</td>
      </tr>`;
  }).join("");
}

async function fetchScorers() {
  scorersArea.innerHTML = "buscando artilheiros…";
  try {
    const campId = await getSerieBId();
    const res = await fetch(`https://api.api-futebol.com.br/v1/campeonatos/${campId}/artilharia`, { headers: authHeaders() });
    if (!res.ok) throw new Error(res.status === 401 ? "chave inválida" : "serviço indisponível");
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.artilheiros || data.data || []);
    if (!list.length) {
      scorersArea.innerHTML = "Nenhum artilheiro retornado pela API no momento.";
      return;
    }
    scorersArea.innerHTML = `<div class="scorers-grid">` + list.slice(0, 15).map(s =>
      `<div class="scorer-row"><span class="n">${s.atleta?.nome_popular || s.nome || "?"} — ${s.time?.nome_popular || s.equipe?.nome_popular || ""}</span><span class="g">${s.gols ?? ""}</span></div>`
    ).join("") + `</div>`;
  } catch (err) {
    scorersArea.innerHTML = `Não foi possível buscar os artilheiros (${err.message}).`;
  }
}

async function loadAll() {
  statusLine.textContent = "carregando dados…";
  try {
    if (!currentTable) currentTable = await loadStandings();
    renderTable();
    fetchScorers();
    const now = new Date();
    statusLine.textContent = `dados atualizados em ${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR")}`;
    keyStatus.textContent = "chave funcionando ✓";
    keyStatus.className = "key-status ok";
  } catch (e) {
    statusLine.textContent = "erro ao carregar dados";
    keyStatus.textContent = `erro: ${e.message}`;
    keyStatus.className = "key-status err";
  }
}

document.getElementById("apiKeyBtn").addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  apiKey = key;
  localStorage.setItem("apiFutebolKey", key);
  currentTable = null;
  serieBId = null;
  loadAll();
});

// --- Squad modal: pitch position chart with player photos ---
const overlay = document.getElementById("overlay");
const modalBadge = document.getElementById("modalBadge");
const modalTeamName = document.getElementById("modalTeamName");
const squadNote = document.getElementById("squadNote");
const squadList = document.getElementById("squadList");

const POSITION_TRANSLATIONS = [
  [/goalkeeper/i, "Goleiro"],
  [/centre-back|center-back|central defender/i, "Zagueiro"],
  [/right-back|right back/i, "Lateral-direito"],
  [/left-back|left back/i, "Lateral-esquerdo"],
  [/full-back|fullback/i, "Lateral"],
  [/defensive midfield/i, "Volante"],
  [/attacking midfield/i, "Meia-atacante"],
  [/central midfield|centre midfield/i, "Meio-campista"],
  [/right midfield/i, "Meia-direita"],
  [/left midfield/i, "Meia-esquerda"],
  [/midfielder|midfield/i, "Meio-campista"],
  [/right winger|right wing/i, "Ponta-direita"],
  [/left winger|left wing/i, "Ponta-esquerda"],
  [/winger/i, "Ponta"],
  [/centre-forward|center-forward|striker/i, "Centroavante"],
  [/forward/i, "Atacante"],
  [/attacker/i, "Atacante"],
  [/defender/i, "Zagueiro"],
];

function translatePosition(pos) {
  if (!pos) return "Posição não informada";
  let result = pos;
  for (const [pattern, pt] of POSITION_TRANSLATIONS) {
    result = result.replace(pattern, pt);
  }
  return result;
}

function playerRow(p) {
  const name = p.strPlayer || "Nome não disponível";
  const photo = p.strThumb || p.strCutout;
  const initials = name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
  const img = photo
    ? `<img class="player-photo" src="${photo}" alt="${name}" loading="lazy">`
    : `<div class="player-photo placeholder">${initials}</div>`;
  const pos = translatePosition(p.strPosition);
  return `<div class="squad-row">${img}<div class="info"><span class="p-name">${name}</span><span class="p-pos">${pos}</span></div></div>`;
}

document.getElementById("tableBody").addEventListener("click", async (e) => {
  const img = e.target.closest(".badge");
  if (!img) return;
  const teamName = img.dataset.teamName;
  modalBadge.src = img.src;
  modalTeamName.textContent = teamName;
  squadList.innerHTML = "";
  squadNote.textContent = "carregando elenco…";
  overlay.classList.add("open");
  try {
    const searchRes = await fetch(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/searchteams.php?t=${encodeURIComponent(teamName)}`);
    const searchData = await searchRes.json();
    const team = (searchData.teams || [])[0];
    if (!team) {
      squadNote.textContent = "Time não encontrado na base de elencos gratuita.";
      return;
    }
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/lookup_all_players.php?id=${team.idTeam}`);
    const data = await res.json();
    const players = data.player || [];
    if (!players.length) {
      squadNote.textContent = "Elenco não disponível para este time na base gratuita.";
      return;
    }

    const sorted = [...players].sort((a, b) =>
      (b.strThumb || b.strCutout ? 1 : 0) - (a.strThumb || a.strCutout ? 1 : 0)
    );
    squadList.innerHTML = sorted.map(playerRow).join("");
    const comFoto = sorted.filter(p => p.strThumb || p.strCutout).length;
    squadNote.textContent = `${players.length} jogadores (${comFoto} com foto disponível). `
      + `Fotos e posições vêm de uma base gratuita e podem estar incompletas ou desatualizadas.`;
  } catch (err) {
    squadNote.textContent = "Erro ao buscar o elenco.";
  }
});

document.getElementById("modalClose").addEventListener("click", () => overlay.classList.remove("open"));
overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });

// --- start ---
renderLegend();
if (apiKey) loadAll();
