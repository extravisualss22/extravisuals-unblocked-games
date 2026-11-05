let games = [];
let activeCategory = "All";

const grid = document.getElementById("grid");
const filters = document.getElementById("filters");
const search = document.getElementById("search");
const empty = document.getElementById("empty");
const library = document.getElementById("library");
const player = document.getElementById("player");
const frameWrap = document.getElementById("frame-wrap");

async function init() {
  try {
    const res = await fetch("games.json");
    games = await res.json();
  } catch (err) {
    grid.textContent = "Could not load games.json. Open this site through a web server, not by double-clicking the file.";
    return;
  }
  renderFilters();
  renderGrid();
  route();
}

function renderFilters() {
  const cats = ["All", ...new Set(games.map(g => g.category))];
  filters.innerHTML = "";
  cats.forEach(cat => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = cat;
    b.setAttribute("aria-pressed", String(cat === activeCategory));
    b.addEventListener("click", () => {
      activeCategory = cat;
      renderFilters();
      renderGrid();
    });
    filters.appendChild(b);
  });
}

function renderGrid() {
  const q = search.value.trim().toLowerCase();
  const list = games.filter(g =>
    (activeCategory === "All" || g.category === activeCategory) &&
    g.title.toLowerCase().includes(q)
  );
  grid.innerHTML = "";
  list.forEach(g => {
    const card = document.createElement("button");
    card.className = "card";
    card.addEventListener("click", () => { location.hash = g.id; });

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.background = g.color || "#444";
    if (g.image) {
      const img = document.createElement("img");
      img.src = g.image;
      img.alt = "";
      img.addEventListener("error", () => { img.remove(); thumb.textContent = g.icon || "🎮"; });
      thumb.appendChild(img);
    } else {
      thumb.textContent = g.icon || "🎮";
    }

    const info = document.createElement("div");
    info.className = "card-info";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = g.title;
    const cat = document.createElement("div");
    cat.className = "card-cat";
    cat.textContent = g.category;
    info.append(title, cat);

    card.append(thumb, info);
    grid.appendChild(card);
  });
  empty.hidden = list.length > 0;
}

function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const game = games.find(g => g.id === id);
  if (!game) {
    frameWrap.innerHTML = "";
    player.hidden = true;
    library.hidden = false;
    document.title = "travis.suda";
    return;
  }
  library.hidden = true;
  player.hidden = false;
  document.getElementById("player-title").textContent = game.title;
  document.getElementById("player-desc").textContent = game.description || "";
  frameWrap.innerHTML = game.iframe; // iframe markup comes from your own games.json
  document.title = game.title + " | travis.suda";
}

document.getElementById("back").addEventListener("click", () => { location.hash = ""; });
document.getElementById("home-link").addEventListener("click", e => { e.preventDefault(); location.hash = ""; });
document.getElementById("fullscreen").addEventListener("click", () => {
  const f = frameWrap.querySelector("iframe");
  if (f && f.requestFullscreen) f.requestFullscreen();
});
search.addEventListener("input", renderGrid);
window.addEventListener("hashchange", route);

init();
