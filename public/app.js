const $ = (s) => document.querySelector(s),
  root = $("#app"),
  modal = $("#modal");
let user,
  state,
  page = "dashboard",
  search = "",
  filter = "all";
const icons = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  contracts: '<path d="M14 3H5v18h14V8zM14 3v6h6M8 13h8M8 17h6"/>',
  quotes: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8M8 12h8M8 16h5"/>',
  clients:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 5a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4"/>',
  packages: '<path d="m12 3 9 5-9 5-9-5zM3 8v9l9 5 9-5V8M12 13v9M7 5l10 5"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 2 4 3-1 3 3 3-3 3 1 2-4-2-2 1-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[k]}</svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (v) => (v ? v.split("-").reverse().join("/") : "A definir");
const statuses = {
  draft: "Rascunho",
  sent: "Enviado",
  approved: "Aprovado",
  signed: "Assinado",
  cancelled: "Cancelado",
};
const badge = (v) =>
  `<span class="badge ${esc(v)}">${statuses[v] || esc(v)}</span>`;
const today = () => new Date().toLocaleDateString("en-CA");
async function api(url, body) {
  const r = await fetch("/api" + url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw Error(e?.error || "Não foi possível concluir a operação.");
  }
  return r.json();
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 3500);
}
function auth(register = false) {
  root.innerHTML = `<div class="auth"><section class="auth-story"><div class="brand"><span class="mark">a</span> AOF studio</div><div><div class="eyebrow">MENOS PAPELADA. MAIS CELEBRAÇÃO.</div><h1>Grandes eventos começam com tudo em ordem.</h1><p>Seu próximo capítulo começa aqui. Organize propostas, formalize contratos e cuide do que faz a festa acontecer.</p><div class="auth-art">✳ ── ◌</div></div><small>AOF Serviços · DJ Kaio Jansen</small></section><section class="auth-form"><form id="authform"><div class="eyebrow">SEU ESCRITÓRIO DE EVENTOS</div><h2>${register ? "Crie sua conta" : "Que bom ter você aqui."}</h2><p class="muted">${register ? "Organização para cada nova celebração." : "Entre para acompanhar seus negócios."}</p>${register ? field("Nome completo", "name", "", "text", true) : ""}${field("E-mail", "email", "", "email", true)}${field("Senha", "password", "", "password", true)}<p class="helper">${register ? "Use pelo menos 10 caracteres. Sua conta terá seus próprios clientes e documentos." : ""}</p><div class="error" id="autherror" role="alert"></div><button class="primary">${register ? "Criar minha conta →" : "Entrar na minha conta →"}</button><button class="auth-switch" type="button">${register ? "Já tenho uma conta. Entrar" : "Primeiro acesso? Criar uma conta"}</button></form></section></div>`;
  $(".auth-switch").onclick = () => auth(!register);
  $("#authform").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      user = await api(register ? "/register" : "/login", b);
      await load();
    } catch (e) {
      $("#autherror").textContent = e.message;
    }
  };
}
function field(
  label,
  name,
  value = "",
  type = "text",
  required = false,
  full = false,
) {
  return `<div class="field ${full ? "full" : ""}"><label for="f-${name}">${label}${required ? " *" : ""}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "number" ? 'min="0" step="0.01"' : ""}></div>`;
}
function area(label, name, value = "", full = true) {
  return `<div class="field ${full ? "full" : ""}"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}">${esc(value)}</textarea></div>`;
}
function select(label, name, options, value = "", required = false) {
  return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${required ? "required" : ""}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
}
async function load() {
  state = await api("/data");
  render();
}
function docs(type) {
  return state.documents.filter((d) => !type || d.type === type);
}
const labels = {
  dashboard: "Visão geral",
  quotes: "Orçamentos",
  contracts: "Contratos",
  clients: "Clientes",
  packages: "Pacotes e preços",
  settings: "Configurações",
};
function render() {
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="mark">a</span><div class="brand-text">aof<span style="color:#8d9c90">studio</span><small>GESTÃO DE EVENTOS</small></div></div><div class="nav-label">ESPAÇO DE TRABALHO</div><nav class="nav">${Object.entries(
    labels,
  )
    .map(
      ([k, l]) =>
        `<button data-page="${k}" class="${page === k ? "active" : ""}" title="${l}">${icon(k)}<span>${l}</span>${k === "contracts" ? `<span class="count">${docs("contract").length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="side-bottom"><div class="userline"><span class="avatar">${esc(user.name[0].toUpperCase())}</span><div><strong>${esc(user.name.split(" ")[0])}</strong><small>Minha conta</small></div><button class="logout" id="logout" title="Sair">↪</button></div></div></aside><main class="main"><header class="topbar"><span>Seu espaço <span style="margin:0 12px;color:#cbd4cb">/</span> <strong>${labels[page]}</strong></span><div class="online"><span class="dot"></span> Tudo pronto para o próximo evento <span class="avatar" style="margin-left:20px;width:30px;height:30px">${esc(user.name[0].toUpperCase())}</span></div></header><div class="content">${content()}</div></main></div>`;
  root.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        search = "";
        filter = "all";
        render();
      }),
  );
  $("#logout").onclick = async () => {
    await api("/logout", {});
    auth();
  };
  bind();
}
function head(title, description, buttons = "") {
  return `<div class="page-head"><div><p class="eyebrow">ORGANIZAÇÃO QUE DÁ O TOM</p><h1>${title}</h1><p>${description}</p></div><div class="actions">${buttons}</div></div>`;
}
function content() {
  if (page === "dashboard") return dashboard();
  if (page === "settings") return settings();
  if (page === "clients")
    return (
      head(
        "Seus clientes",
        "Cada evento começa com uma boa conexão.",
        '<button class="primary" data-new="client">＋ Novo cliente</button>',
      ) +
      toolbar() +
      `<div class="panel" id="list">${clientTable()}</div>`
    );
  if (page === "packages")
    return (
      head(
        "Pacotes e preços",
        "Serviços bem definidos. Propostas sem complicação.",
        '<button class="primary" data-new="package">＋ Novo pacote</button>',
      ) +
      `<div class="list-cards">${state.packages.map((p) => `<div class="panel package-detail"><div class="eyebrow">EXPERIÊNCIAS PARA CELEBRAR</div><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><div class="price">${money(p.price)}</div><p>${esc(p.equipment)}</p><button data-edit-package="${p.id}">Editar pacote</button></div>`).join("") || empty("Seu primeiro pacote", "Cadastre os serviços, equipamentos e o preço de cada experiência.", "package", "Criar pacote")}</div>`
    );
  const isQ = page === "quotes";
  return (
    head(
      isQ ? "Orçamentos" : "Contratos",
      isQ
        ? "Transforme boas conversas em novos eventos."
        : "Cada detalhe combinado. Cada celebração protegida.",
      `<button class="primary" data-new="${isQ ? "quote" : "contract"}">＋ Novo ${isQ ? "orçamento" : "contrato"}</button>`,
    ) +
    toolbar(true) +
    `<div class="panel" id="list">${docTable(docs(isQ ? "quote" : "contract"), false)}</div>`
  );
}
function toolbar(withFilter = false) {
  return `<div class="toolbar"><input type="search" id="search" placeholder="Buscar por nome ou evento…" aria-label="Buscar">${
    withFilter
      ? `<select id="statusfilter" style="max-width:190px" aria-label="Filtrar por situação"><option value="all">Todas as situações</option>${Object.entries(
          statuses,
        )
          .map(([v, l]) => `<option value="${v}">${l}</option>`)
          .join("")}</select>`
      : ""
  }</div>`;
}
function empty(title, description, kind, label) {
  return `<div class="empty"><div class="empty-symbol">◇</div><h3>${title}</h3><p>${description}</p>${kind ? `<button class="primary" data-new="${kind}">＋ ${label}</button>` : ""}</div>`;
}
function dashboard() {
  const cs = docs("contract"),
    qs = docs("quote"),
    active = cs.filter((d) => ["signed", "approved"].includes(d.status));
  return (
    head(
      `Tudo em harmonia, ${esc(user.name.split(" ")[0])}.`,
      "Aqui, cada detalhe está no lugar para o seu próximo grande evento.",
      '<button data-new="quote">＋ Novo orçamento</button><button class="primary" data-new="contract">＋ Novo contrato</button>',
    ) +
    `<div class="cards"><div class="card"><div class="card-top">Contratos emitidos <span class="mini-icon">▤</span></div><div class="stat">${String(cs.length).padStart(2, "0")}</div><small>Documentos registrados na sua conta</small></div><div class="card"><div class="card-top">Orçamentos em aberto <span class="mini-icon">▧</span></div><div class="stat">${String(qs.filter((d) => ["draft", "sent"].includes(d.status)).length).padStart(2, "0")}</div><small>Novas celebrações a caminho</small></div><div class="card"><div class="card-top">Clientes cadastrados <span class="mini-icon">♧</span></div><div class="stat">${String(state.clients.length).padStart(2, "0")}</div><small>Conexões que viram boas histórias</small></div><div class="card feature"><div class="card-top">Valor contratado <span class="mini-icon">↗</span></div><div class="stat">${money(active.reduce((s, d) => s + Number(d.total), 0))}</div><small>Contratos aprovados ou assinados</small></div></div><div class="grid"><div><section class="panel"><div class="panel-title"><h2>Documentos recentes</h2><button data-page="contracts" style="font-size:11px;border:0;padding:0">Ver contratos ↗</button></div>${docTable(state.documents.slice(0, 6), true)}</section><section class="panel" style="margin-top:24px"><div class="panel-title"><h2>Próximos eventos</h2><span>Agenda de celebrações</span></div>${eventList()}</section></div><aside class="aside-cards"><section class="panel"><div class="panel-title"><h2>Seu catálogo de experiências</h2><span>✧</span></div>${
      state.packages[0]
        ? `<div class="package-box"><div class="package-label">EM DESTAQUE</div><h3>${esc(state.packages[0].name)}</h3><div class="price">${money(state.packages[0].price)}</div><p class="muted" style="font-size:12px">${esc(state.packages[0].description)}</p><ul>${state.packages[0].equipment
            .split("\n")
            .slice(0, 4)
            .map((x) => `<li>${esc(x)}</li>`)
            .join(
              "",
            )}</ul><button data-page="packages">Gerenciar pacotes ↗</button></div>`
        : empty(
            "Monte seu catálogo",
            "Crie seu primeiro pacote.",
            "package",
            "Criar pacote",
          )
    }</section><div class="tip"><h3>✳ Um detalhe que faz diferença</h3><p>Um bom contrato deixa tudo claro. Revise as cláusulas e os horários antes de enviar para o cliente.</p></div></aside></div><div class="bottom-note"><span>Feito para organizar. Pensado para celebrar.</span><span>AOF STUDIO · GESTÃO DE EVENTOS</span></div>`
  );
}
function eventList() {
  const list = docs("contract")
    .filter((d) => d.date >= today() && d.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  return list.length
    ? list
        .map(
          (d) =>
            `<div style="padding:18px 24px;border-bottom:1px solid #edf0ed;display:flex;gap:18px;align-items:center"><span class="badge approved">${date(d.date)}</span><div><strong style="font-size:12px">${esc(d.event)}</strong><div class="muted" style="font-size:11px;margin-top:5px">${esc(d.venue || "Local a definir")}</div></div></div>`,
        )
        .join("")
    : empty(
        "A agenda está aberta",
        "Os próximos eventos dos seus contratos aparecerão aqui.",
      );
}
function docTable(list, compact) {
  list = list.filter(
    (d) =>
      `${d.client.name} ${d.event} ${d.number}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || d.status === filter),
  );
  if (!list.length)
    return empty(
      state.documents.length
        ? "Nenhum documento por aqui"
        : "Sua próxima história começa aqui",
      state.documents.length
        ? "Experimente outra busca ou crie um documento."
        : "Crie um orçamento, combine os detalhes e transforme em contrato.",
      "quote",
      "Criar primeiro orçamento",
    );
  return `<div class="table-wrap"><table><thead><tr><th>CLIENTE / EVENTO</th><th>DATA</th><th>VALOR</th><th>SITUAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>${list.map((d) => `<tr><td><strong>${esc(d.client.name)}</strong><small>${esc(d.event)} · ${d.type === "quote" ? "ORÇ." : "CONT."}</small></td><td>${date(d.date)}</td><td>${money(d.total)}</td><td>${badge(d.status)}</td><td><div class="rowactions"><button data-edit-doc="${d.id}" title="Editar documento">Editar</button><button data-pdf="${d.id}" title="Baixar PDF">PDF ↓</button>${d.type === "quote" ? `<button data-convert="${d.id}" title="Converter em contrato">→ Contrato</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>`;
}
function clientTable() {
  const list = state.clients.filter((c) =>
    `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  if (!list.length)
    return empty(
      "Conheça seu próximo cliente",
      "Cadastre nome, contato e os dados necessários para os documentos.",
      "client",
      "Cadastrar cliente",
    );
  return `<div class="table-wrap"><table><thead><tr><th>NOME</th><th>E-MAIL</th><th>CONTATO</th><th>CPF / CNPJ</th><th></th></tr></thead><tbody>${list.map((c) => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.document)}</td><td><button data-edit-client="${c.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>`;
}
function settings() {
  const c = state.settings;
  return (
    head(
      "A identidade da sua empresa",
      "Dados comerciais e cláusulas usados nos novos documentos.",
    ) +
    `<section class="panel settings-panel"><div class="notice">As cláusulas foram adaptadas dos documentos enviados. Revise o texto com assessoria jurídica antes do uso. Alterações aqui valem para novos documentos; os já emitidos mantêm os dados registrados.</div><form id="settingsform"><div class="form-grid">${field("Empresa", "company", c.company, "text", true)}${field("Representante", "representative", c.representative)}${field("CNPJ", "cnpj", c.cnpj)}${field("E-mail", "email", c.email, "email")}${field("Telefone", "phone", c.phone)}${field("Chave PIX", "pix", c.pix)}${field("Endereço", "address", c.address, "text", false, true)}${area("Cláusulas padrão · editáveis", "clauses", c.clauses)}</div><button class="primary" style="margin-top:22px">Salvar configurações</button><div class="error" role="alert"></div></form></section>`
  );
}
function openModal(title, html, onSubmit) {
  modal.innerHTML = `<form id="modalform"><div class="modal-head"><h2>${title}</h2><button type="button" data-close aria-label="Fechar">×</button></div><div class="modal-body"><div class="form-grid">${html}</div><div class="error" role="alert"></div></div><div class="modal-foot"><button type="button" data-close>Cancelar</button><button class="primary">Salvar ${title.toLowerCase().includes("orçamento") ? "orçamento" : title.toLowerCase().includes("contrato") ? "contrato" : "cadastro"}</button></div></form>`;
  modal
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => modal.close()));
  $("#modalform").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(e.target)));
      modal.close();
      await load();
      toast("Salvo com sucesso.");
    } catch (err) {
      modal.querySelector(".error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
  modal.showModal();
}
function editClient(c = {}) {
  openModal(
    c.id ? "Editar cliente" : "Novo cliente",
    field("Nome completo", "name", c.name, "text", true) +
      field("CPF / CNPJ", "document", c.document) +
      field("E-mail", "email", c.email, "email") +
      field("Telefone", "phone", c.phone) +
      field("Endereço completo", "address", c.address, "text", false, true),
    (b) => api("/records/clients", { ...b, id: c.id }),
  );
}
function editPackage(p = {}) {
  openModal(
    p.id ? "Editar pacote" : "Novo pacote",
    field("Nome do pacote", "name", p.name, "text", true) +
      field("Preço (R$)", "price", p.price, "number", true) +
      area("Descrição", "description", p.description) +
      area("Equipamentos e serviços · um por linha", "equipment", p.equipment),
    (b) => api("/records/packages", { ...b, id: p.id, price: Number(b.price) }),
  );
}
function editDoc(type, d = {}) {
  if (!state.clients.length) {
    toast("Cadastre um cliente antes de criar seu documento.");
    page = "clients";
    render();
    editClient();
    return;
  }
  const c = d.client || state.clients[0],
    p = state.packages[0] || {};
  openModal(
    d.id
      ? "Editar " + (type === "quote" ? "orçamento" : "contrato")
      : "Novo " + (type === "quote" ? "orçamento" : "contrato"),
    `<div class="form-section">01 / CLIENTE E EVENTO</div>${select(
      "Cliente",
      "clientId",
      state.clients.map((c) => [c.id, c.name]),
      d.clientId || c.id,
      true,
    )}${select(
      "Situação",
      "status",
      Object.entries(statuses).filter(
        ([v]) => type === "contract" || v !== "signed",
      ),
      d.status || "draft",
    )}${field("Nome do evento", "event", d.event, "text", true)}${field("Data do evento", "date", d.date, "date", true)}${field("Local / endereço do evento", "venue", d.venue, "text", false, true)}${field("Convidados", "guests", d.guests, "number")}${field("Montagem", "setup", d.setup, "time")}${field("Cerimônia", "ceremony", d.ceremony, "time")}${field("Início da festa", "start", d.start, "time")}${field("Término (pode ser no dia seguinte)", "end", d.end, "time")}<div class="form-section">02 / SERVIÇOS E VALORES</div>${select("Pacote de referência", "packageId", [["", "Personalizado"], ...state.packages.map((p) => [p.id, p.name])], d.id ? d.packageId : p.id)}${field("Nome do pacote / serviço", "packageName", d.packageName || p.name, "text", true)}${area("Equipamentos e serviços incluídos", "equipment", d.equipment ?? p.equipment)}${field("Valor total (R$)", "total", d.total ?? p.price, "number", true)}${field("Hora adicional (R$)", "extraHour", d.extraHour ?? 500, "number")}${type === "quote" ? field("Validade do orçamento", "validUntil", d.validUntil, "date", true) : ""}<div class="field full"><label>Parcelas</label><div class="helper">Cadastre os vencimentos. A soma precisa corresponder ao total. Deixe vazio se ainda não houver parcelamento definido.</div><div id="payments"></div><button type="button" id="addpayment" style="align-self:flex-start">＋ Adicionar parcela</button></div>${area("Forma de pagamento e condições", "paymentNotes", d.paymentNotes || "Pagamento via PIX ou dinheiro.")}<div class="form-section">03 / CONDIÇÕES DO DOCUMENTO</div>${type === "contract" ? area("Cláusulas contratuais · revise antes de emitir", "clauses", d.clauses ?? state.settings.clauses) : ""}${type === "contract" ? `<div class="field full"><label><input type="checkbox" name="imageConsent" ${d.imageConsent ? "checked" : ""}> O cliente autorizou expressamente o uso de imagem</label><p class="helper">Marque “Assinado” apenas após coletar a assinatura. O sistema gera PDFs; não realiza assinatura eletrônica.</p></div>` : ""}${area("Observações adicionais", "notes", d.notes)}`,
    async (b) => {
      const payments = [...modal.querySelectorAll(".payment-row")].map(
        (row) => ({
          date: row.querySelector("[type=date]").value,
          amount: Number(row.querySelector("[type=number]").value),
        }),
      );
      const client = state.clients.find((c) => String(c.id) === b.clientId);
      await api("/records/documents", {
        ...b,
        id: d.id,
        type,
        client: { ...client },
        total: Number(b.total),
        extraHour: Number(b.extraHour),
        imageConsent: b.imageConsent === "on",
        clauses: b.clauses || state.settings.clauses,
        payments,
      });
    },
  );
  const addPayment = (p = {}) => {
    const row = document.createElement("div");
    row.className = "payment-row";
    row.innerHTML = `<input aria-label="Vencimento da parcela" type="date" value="${esc(p.date)}" required><input aria-label="Valor da parcela" type="number" min="0" step="0.01" value="${esc(p.amount)}" placeholder="Valor em R$" required><button type="button" aria-label="Remover parcela">×</button>`;
    row.querySelector("button").onclick = () => row.remove();
    $("#payments").append(row);
  };
  for (const payment of d.payments || []) addPayment(payment);
  $("#addpayment").onclick = () => addPayment();
  $("#f-packageId").onchange = (e) => {
    const p = state.packages.find((p) => String(p.id) === e.target.value);
    if (p) {
      $("#f-packageName").value = p.name;
      $("#f-total").value = p.price;
      $("#f-equipment").value = p.equipment;
    }
  };
}
function bind() {
  root.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        search = "";
        filter = "all";
        render();
      }),
  );
  root.querySelectorAll("[data-new]").forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.new;
        k === "client"
          ? editClient()
          : k === "package"
            ? editPackage()
            : editDoc(k);
      }),
  );
  root
    .querySelectorAll("[data-edit-client]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          editClient(
            state.clients.find((c) => c.id === Number(b.dataset.editClient)),
          )),
    );
  root
    .querySelectorAll("[data-edit-package]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          editPackage(
            state.packages.find((p) => p.id === Number(b.dataset.editPackage)),
          )),
    );
  root.querySelectorAll("[data-edit-doc]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = state.documents.find(
          (d) => d.id === Number(b.dataset.editDoc),
        );
        editDoc(d.type, d);
      }),
  );
  root.querySelectorAll("[data-pdf]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = document.createElement("a");
        a.href = `/api/documents/${b.dataset.pdf}/pdf`;
        a.download = "";
        a.click();
      }),
  );
  root.querySelectorAll("[data-convert]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api(`/documents/${b.dataset.convert}/convert`, {});
          page = "contracts";
          await load();
          toast("Contrato criado. Revise os dados antes de emitir.");
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      }),
  );
  function refreshList() {
    if (page === "clients") $("#list").innerHTML = clientTable();
    else
      $("#list").innerHTML = docTable(
        docs(page === "quotes" ? "quote" : "contract"),
      );
    bindRows();
  }
  function bindRows() {
    const input = $("#search"),
      sf = $("#statusfilter");
    if (input)
      input.oninput = () => {
        search = input.value;
        refreshList();
      };
    if (sf)
      sf.onchange = () => {
        filter = sf.value;
        refreshList();
      };
    root
      .querySelectorAll("#list [data-new]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            b.dataset.new === "client" ? editClient() : editDoc(b.dataset.new)),
      );
    root.querySelectorAll("#list [data-edit-doc]").forEach(
      (b) =>
        (b.onclick = () => {
          const d = state.documents.find(
            (d) => d.id === Number(b.dataset.editDoc),
          );
          editDoc(d.type, d);
        }),
    );
    root
      .querySelectorAll("#list [data-edit-client]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editClient(
              state.clients.find((c) => c.id === Number(b.dataset.editClient)),
            )),
      );
    root.querySelectorAll("#list [data-pdf]").forEach(
      (b) =>
        (b.onclick = () => {
          location.href = `/api/documents/${b.dataset.pdf}/pdf`;
        }),
    );
    root.querySelectorAll("#list [data-convert]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await api(`/documents/${b.dataset.convert}/convert`, {});
            page = "contracts";
            search = "";
            filter = "all";
            await load();
            toast("Contrato criado.");
          } catch (e) {
            toast(e.message);
          }
        }),
    );
  }
  bindRows();
  if ($("#settingsform"))
    $("#settingsform").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/records/settings", {
          ...Object.fromEntries(new FormData(e.target)),
          id: state.settings.id,
        });
        await load();
        toast("Configurações salvas.");
      } catch (err) {
        e.target.querySelector(".error").textContent = err.message;
      }
    };
}
try {
  user = await api("/me");
  await load();
} catch {
  auth();
}
