// Endereço por tela com hash, por exemplo:
//   #/                                  Visão geral
//   #/orcamentos?situacao=enviados      lista filtrada
//   #/orcamentos/12                     tela do documento
//   #/clientes/7                        tela do cliente
// Funções puras, sem DOM, para poderem ser verificadas também no Node.

export const PAGE_SLUGS = {
  dashboard: "",
  quotes: "orcamentos",
  contracts: "contratos",
  clients: "clientes",
  packages: "pacotes",
  settings: "configuracoes",
};
export const STATUS_SLUGS = {
  draft: "rascunhos",
  sent: "enviados",
  approved: "aprovados",
  signed: "assinados",
  expired: "vencidos",
  converted: "convertidos",
  cancelled: "cancelados",
  archived: "arquivados",
};
export const SORT_SLUGS = {
  recent: "recentes",
  eventAsc: "evento",
  eventDesc: "evento-desc",
  value: "valor",
};
const invert = (map) => Object.fromEntries(Object.entries(map).map(([key, slug]) => [slug, key]));
const SLUG_PAGES = invert(PAGE_SLUGS);
const SLUG_STATUSES = invert(STATUS_SLUGS);
const SLUG_SORTS = invert(SORT_SLUGS);
const DETAIL_PAGES = new Set(["quotes", "contracts", "clients"]);
const DEFAULTS = { page: "dashboard", id: null, filter: "all", sort: "recent", search: "", known: true };

function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** Lê o hash atual. Hash vazio ou que não começa com "#/" leva à Visão geral. */
export function parseRoute(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  if (!raw.startsWith("/")) return { ...DEFAULTS };
  const [path, query = ""] = raw.slice(1).split("?");
  const segments = path.split("/").filter(Boolean).map(decode);
  if (segments.includes(null)) return { ...DEFAULTS, known: false };
  const [slug = "", idPart, ...rest] = segments;
  const page = SLUG_PAGES[slug];
  if (page === undefined || rest.length) return { ...DEFAULTS, known: false };
  let id = null;
  if (idPart !== undefined) {
    if (!DETAIL_PAGES.has(page) || !/^[1-9]\d{0,15}$/.test(idPart)) return { ...DEFAULTS, known: false };
    id = Number(idPart);
  }
  let params;
  try {
    params = new URLSearchParams(query);
  } catch {
    params = new URLSearchParams();
  }
  return {
    page,
    id,
    filter: SLUG_STATUSES[params.get("situacao")] || "all",
    sort: SLUG_SORTS[params.get("ordem")] || "recent",
    search: (params.get("busca") || "").slice(0, 120),
    known: true,
  };
}

/** Monta o hash de uma rota; filtros só entram nas listas. */
export function buildHash({ page = "dashboard", id = null, filter = "all", sort = "recent", search = "" } = {}) {
  let hash = `#/${PAGE_SLUGS[page] ?? ""}`;
  if (id != null) return `${hash}/${id}`;
  const params = new URLSearchParams();
  if (filter !== "all" && STATUS_SLUGS[filter]) params.set("situacao", STATUS_SLUGS[filter]);
  if (sort !== "recent" && SORT_SLUGS[sort]) params.set("ordem", SORT_SLUGS[sort]);
  if (search.trim()) params.set("busca", search.trim());
  const query = params.toString();
  return query ? `${hash}?${query}` : hash;
}

/** Página de lista de cada tipo de documento. */
export const listPageFor = (type) => (type === "contract" ? "contracts" : "quotes");
