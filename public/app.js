import {
  EQUIPMENT_CATEGORIES,
  categoryLabel,
  cleanItems,
  equipmentText,
  itemsTotal,
  qtyLabel,
} from "./catalog.js";
import { QUOTE_TEMPLATES, dateBeforeEvent } from "./quote-templates.js";
import {
  addDays,
  daysBetween,
  formatMoneyInput,
  maskDocument,
  maskPhone,
  parseMoney,
  splitAmount,
  whatsappNumber,
} from "./formatters.js";
import { buildHash, listPageFor, parseRoute } from "./routes.js";
import {
  SORT_LABELS,
  STATUS_LABELS,
  TABS,
  TAB_LABELS,
  displayStatus as statusOf,
  inTab,
  matchesSearch,
  normalizeText,
  sortDocs,
  tabCounts,
  validityInfo,
  whatsappLink,
  whatsappMessage,
} from "./documents.js";

const $ = (selector, scope = document) => scope.querySelector(selector),
  $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)],
  root = $("#app"),
  modal = $("#modal"),
  subdialog = $("#subdialog"),
  picker = $("#picker"),
  confirmBox = $("#confirm"),
  rowMenu = $("#row-menu"),
  reauthDialog = $("#reauth");
let user,
  state,
  route = parseRoute(location.hash), // tela atual: página, id e filtros da lista
  renderedHash = null, // hash da tela desenhada, para voltar se a saída for cancelada
  pendingFocus = null, // seletor (ou "heading") que recebe o foco depois do próximo render
  pageGuard = null, // indica alterações não salvas no formulário da página atual
  menuTrigger = null, // botão "⋯" que abriu o menu de ações da linha
  reauthPending = null,
  toastTimer,
  errorSeq = 0;
const forms = new Map(); // diálogo → controle do formulário aberto nele
const scrollMemory = new Map(); // posição da rolagem de cada lista, para o botão Voltar

const DEFAULT_VALIDITY_DAYS = 15;
const DISCARD_MESSAGE =
  "Descartar as alterações? O que você digitou neste formulário será perdido.";
const LEAVE_MESSAGE =
  "Sair sem salvar? As alterações desta página serão perdidas.";
const AUTH_ROUTES = ["/login", "/register", "/me", "/logout"];
const icons = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  contracts: '<path d="M14 3H5v18h14V8zM14 3v6h6M8 13h8M8 17h6"/>',
  quotes: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8M8 12h8M8 16h5"/>',
  clients:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 5a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4"/>',
  packages: '<path d="m12 3 9 5-9 5-9-5zM3 8v9l9 5 9-5V8M12 13v9M7 5l10 5"/>',
  products:
    '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6zM7.5 7.5h.01"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 2 4 3-1 3 3 3-3 3 1 2-4-2-2 1-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>',
  trend: '<path d="m4 17 6-6 4 4 6-7M15 8h5v5"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chat: '<path d="M4.5 19.5 6 15.3A7.5 7.5 0 1 1 8.8 18z"/><path d="M9 10.5h6M9 13.5h4"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[k]}</svg>`;
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
// Vencido, Convertido e Arquivado são calculados, nunca escolhidos à mão.
const statusLabel = (v) => STATUS_LABELS[v] || v;
const badge = (v) =>
  `<span class="badge ${esc(v)}">${esc(statusLabel(v))}</span>`;
const today = () => new Date().toLocaleDateString("en-CA");
const firstName = () => (user?.name || "").trim().split(/\s+/)[0] || "";
const initial = () => esc(((user?.name || "?").trim()[0] || "?").toUpperCase());
const validityDays = () => {
  const days = Number(state?.settings?.quoteValidityDays);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_VALIDITY_DAYS;
};
const debounce = (fn, wait) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

async function api(url, body, { retry = true, method } = {}) {
  const r = await fetch("/api" + url, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Sessão expirada no meio do uso: pede a senha e repete a operação sem perder o formulário.
  if (r.status === 401 && retry && user && !AUTH_ROUTES.includes(url)) {
    await reauthenticate();
    return api(url, body, { retry: false, method });
  }
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    const error = Error(e?.error || "Não foi possível concluir a operação.");
    error.status = r.status;
    throw error;
  }
  return r.json();
}

// ---------- Avisos ----------
function toast(message, type = "success", { action = null } = {}) {
  if (type === "error") {
    $("#alert-wrap").classList.add("show");
    $("#alert-close").hidden = false;
    $("#alert").textContent = "";
    requestAnimationFrame(() => ($("#alert").textContent = message));
    return;
  }
  const box = $("#toast"),
    text = document.createElement("span");
  text.textContent = message;
  box.replaceChildren(text);
  // Ação opcional, como "Desfazer". O aviso fica mais tempo e pausa com o mouse ou o foco.
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.onclick = () => {
      hideToast();
      action.onClick();
    };
    box.append(button);
  }
  box.classList.add("show");
  box.dataset.duration = action ? "10000" : "5000";
  startToastTimer();
}
function startToastTimer() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    hideToast,
    Number($("#toast").dataset.duration || 5000),
  );
}
function hideToast() {
  clearTimeout(toastTimer);
  const box = $("#toast");
  box.classList.remove("show");
  box.replaceChildren();
}
function closeAlert() {
  $("#alert-wrap").classList.remove("show");
  $("#alert").textContent = "";
  $("#alert-close").hidden = true;
}

// ---------- Campos de formulário ----------
const REQUIRED = ' <span class="req" aria-hidden="true">*</span>';
const describedBy = (id, hint) =>
  hint ? ` aria-describedby="${id}-hint"` : "";
const hintHtml = (id, hint) =>
  hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : "";
const section = (title) => `<h3 class="form-section">${title}</h3>`;
const LEGEND =
  '<p class="form-legend">Campos marcados com * são obrigatórios.</p>';

function field(
  label,
  name,
  value = "",
  type = "text",
  required = false,
  full = false,
  { attrs = "", hint = "" } = {},
) {
  const id = `f-${name}`;
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${required ? REQUIRED : ""}</label><input id="${id}" name="${name}" type="${type}" value="${esc(value)}"${required ? " required" : ""}${describedBy(id, hint)} ${attrs}>${hintHtml(id, hint)}</div>`;
}
function moneyField(
  label,
  name,
  value = "",
  required = false,
  { attrs = "", hint = "" } = {},
) {
  const id = `f-${name}`;
  return `<div class="field"><label for="${id}">${label}<span class="sr-only"> em reais</span>${required ? REQUIRED : ""}</label><div class="input-affix"><span class="affix" aria-hidden="true">R$</span><input id="${id}" name="${name}" type="text" inputmode="decimal" autocomplete="off" data-money value="${esc(formatMoneyInput(value))}"${required ? " required" : ""}${describedBy(id, hint)} ${attrs}></div>${hintHtml(id, hint)}</div>`;
}
function area(
  label,
  name,
  value = "",
  full = true,
  { attrs = "", hint = "" } = {},
) {
  const id = `f-${name}`;
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}</label><textarea id="${id}" name="${name}"${describedBy(id, hint)} ${attrs}>${esc(value)}</textarea>${hintHtml(id, hint)}</div>`;
}
function select(
  label,
  name,
  options,
  value = "",
  required = false,
  { placeholder = null, hint = "", full = false } = {},
) {
  const id = `f-${name}`;
  const opts =
    (placeholder != null
      ? `<option value="">${esc(placeholder)}</option>`
      : "") +
    options
      .map(
        ([v, l]) =>
          `<option value="${esc(v)}"${String(v) === String(value ?? "") ? " selected" : ""}>${esc(l)}</option>`,
      )
      .join("");
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${required ? REQUIRED : ""}</label><select id="${id}" name="${name}"${required ? " required" : ""}${describedBy(id, hint)}>${opts}</select>${hintHtml(id, hint)}</div>`;
}
function passwordField(
  id,
  name,
  label,
  autocomplete,
  attrs = "",
  full = false,
) {
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${REQUIRED}</label><div class="input-affix password"><input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required ${attrs}><button type="button" class="toggle-password" data-toggle-password="${id}">Mostrar<span class="sr-only"> senha</span></button></div></div>`;
}

// ---------- Validação acessível (erro no campo + resumo no topo) ----------
function updateCustomValidity(el) {
  if (el.matches?.("[data-combo-input]")) {
    const hidden = el.form?.elements.namedItem(el.dataset.comboInput);
    el.setCustomValidity(
      el.required && !hidden?.value
        ? el.value.trim()
          ? "Escolha um cliente da lista ou cadastre um novo."
          : "Selecione o cliente."
        : "",
    );
    return;
  }
  if (!el.matches?.("[data-money]")) return;
  const value = parseMoney(el.value);
  el.setCustomValidity(
    el.value.trim() && (value == null || Number.isNaN(value))
      ? "Informe um valor válido, por exemplo 2.900,00."
      : "",
  );
}
function fieldLabel(el) {
  const label =
    el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  if (!label) return el.getAttribute("aria-label") || "Campo";
  return [...label.childNodes]
    .filter((node) => !(node.nodeType === 1 && node.matches(".req, .sr-only")))
    .map((node) => node.textContent)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
function validationMessage(el) {
  const v = el.validity;
  if (v.customError) return el.validationMessage;
  if (v.valueMissing) {
    if (el.tagName === "SELECT") return "Selecione uma opção.";
    if (el.type === "date") return "Informe a data.";
    if (el.type === "time") return "Informe o horário.";
    if (el.type === "password") return "Informe a senha.";
    return "Preencha este campo.";
  }
  if (v.typeMismatch)
    return el.type === "email"
      ? "Informe um e-mail válido, como nome@exemplo.com."
      : "Verifique o formato.";
  if (v.tooShort) return `Use pelo menos ${el.minLength} caracteres.`;
  if (v.rangeUnderflow) return `Use um valor a partir de ${el.min}.`;
  if (v.rangeOverflow) return `Use um valor até ${el.max}.`;
  if (v.stepMismatch) return "Use um número inteiro.";
  if (v.badInput) return "Informe um número válido.";
  return el.validationMessage || "Verifique este campo.";
}
function addDescribedBy(el, id) {
  const ids = new Set(
    (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean),
  );
  ids.add(id);
  el.setAttribute("aria-describedby", [...ids].join(" "));
}
function removeDescribedBy(el, id) {
  const ids = (el.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((x) => x && x !== id);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}
function showError(error) {
  const { el, message } = error;
  if (!el.id) el.id = `campo-${++errorSeq}`;
  const errorId = `${el.id}-erro`;
  document.getElementById(errorId)?.remove();
  const p = document.createElement("p");
  p.className = "field-error";
  p.id = errorId;
  p.textContent = message;
  (error.after || el.closest(".input-affix") || el).after(p);
  for (const target of error.targets || [el]) {
    target.setAttribute("aria-invalid", "true");
    addDescribedBy(target, errorId);
    target.dataset.errorId = errorId;
    if (error.group) target.dataset.groupError = "1";
  }
}
function clearError(el) {
  const errorId = el?.dataset.errorId;
  if (!errorId) return;
  document.getElementById(errorId)?.remove();
  for (const target of $$(`[data-error-id="${errorId}"]`)) {
    target.removeAttribute("aria-invalid");
    removeDescribedBy(target, errorId);
    delete target.dataset.errorId;
    delete target.dataset.groupError;
  }
  const item = document.querySelector(
    `.error-summary [data-error-for="${errorId}"]`,
  );
  const summary = item?.closest(".error-summary");
  item?.remove();
  if (summary && !summary.querySelector("li")) summary.remove();
}
function clearErrors(form) {
  for (const el of $$("[data-error-id]", form)) clearError(el);
  $$(".error-summary", form).forEach((box) => box.remove());
}
function showSummary(host, errors, title = null) {
  host.querySelector(".error-summary")?.remove();
  const box = document.createElement("div");
  box.className = "error-summary";
  box.setAttribute("role", "alert");
  box.tabIndex = -1;
  const heading =
    title ||
    (errors.length === 1
      ? "Revise 1 campo antes de salvar"
      : `Revise ${errors.length} campos antes de salvar`);
  box.innerHTML = `<h3>${esc(heading)}</h3><ul>${errors
    .map((e) =>
      e.el
        ? `<li data-error-for="${esc(e.el.id)}-erro"><a href="#${esc(e.el.id)}">${esc(e.label || fieldLabel(e.el))}: ${esc(e.message)}</a></li>`
        : `<li>${esc(e.message)}</li>`,
    )
    .join("")}</ul>`;
  host.prepend(box);
  box.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    const target = document.getElementById(link.getAttribute("href").slice(1));
    target?.focus();
    target?.scrollIntoView({ block: "center" });
  });
  box.scrollIntoView({ block: "nearest" });
  box.focus();
}
function validateForm(form, { host = null, extra = [] } = {}) {
  clearErrors(form);
  const errors = [];
  for (const el of form.elements) {
    if (!(
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ))
      continue;
    if (el.disabled || !el.willValidate) continue;
    updateCustomValidity(el);
    if (!el.checkValidity())
      errors.push({ el, message: validationMessage(el) });
  }
  errors.push(...extra);
  for (const error of errors) showError(error);
  if (!errors.length) return true;
  if (host) showSummary(host, errors);
  else errors[0].el.focus();
  return false;
}
function revalidate(el) {
  if (!el?.dataset?.errorId || el.dataset.groupError || !el.willValidate)
    return;
  updateCustomValidity(el);
  if (el.checkValidity()) clearError(el);
}

// ---------- Estado do formulário e rascunhos ----------
function formValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    values[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  if ($("#payments", form))
    values.__payments = $$(".payment-row", form).map((row) => [
      $('[type="date"]', row).value,
      $("[data-money]", row).value,
    ]);
  // Itens do catálogo são linhas montadas na hora, não campos com nome.
  if ($("#items", form)) values.__items = readItemRows(form);
  return values;
}
// Compara valores, e não a formatação: "2900" e "2.900,00" são a mesma coisa.
function comparable(form) {
  const values = formValues(form);
  for (const el of $$("[data-money][name]", form))
    if (el.name in values) values[el.name] = parseMoney(el.value);
  if (values.__payments)
    values.__payments = values.__payments.map(([d, a]) => [d, parseMoney(a)]);
  return JSON.stringify(values);
}
const draftKey = (type, id) => `aof-draft:${user.id}:${type}:${id ?? "novo"}`;
function readDraft(key) {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || "null");
    return draft?.values ? draft : null;
  } catch {
    return null;
  }
}
function clearDrafts() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`aof-draft:${user?.id}:`))
        localStorage.removeItem(key);
  } catch {}
}
function focusSelector(el) {
  if (!el || !root.contains(el)) return null;
  for (const attr of [
    "data-edit-doc",
    "data-edit-client",
    "data-edit-product",
    "data-edit-package",
    "data-convert",
    "data-send",
    "data-duplicate",
    "data-quote-template",
    "data-new-for",
    "data-new",
  ])
    if (el.hasAttribute(attr))
      return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
  // Ações escolhidas no menu "⋯" devolvem o foco ao próprio botão "⋯" da linha.
  if (el.closest("#row-menu") && menuTrigger?.dataset.menu)
    return `[data-menu="${CSS.escape(menuTrigger.dataset.menu)}"]`;
  return null;
}

// ---------- Sessão ----------
function auth(register = false) {
  user = null;
  state = null;
  pageGuard = null;
  document.title = `${register ? "Criar conta" : "Entrar"} · AOF Studio`;
  root.innerHTML = `<div class="auth"><section class="auth-story"><div class="brand"><img class="mark app-icon" src="/aof-studio.ico" alt="" aria-hidden="true"> AOF studio</div><div><p class="eyebrow">MENOS PAPELADA. MAIS CELEBRAÇÃO.</p><p class="auth-headline">Grandes eventos começam com tudo em ordem.</p><p>Seu próximo capítulo começa aqui. Organize propostas, formalize contratos e cuide do que faz a festa acontecer.</p><div class="auth-art" aria-hidden="true">✳ ── ◌</div></div><small>AOF Serviços · DJ Kaio Jansen</small></section><main class="auth-form"><form id="authform" novalidate><p class="eyebrow">SEU ESCRITÓRIO DE EVENTOS</p><h1>${register ? "Crie sua conta" : "Que bom ter você aqui."}</h1><p class="muted">${register ? "Organização para cada nova celebração." : "Entre para acompanhar seus negócios."}</p>${register ? field("Nome completo", "name", "", "text", true, false, { attrs: 'autocomplete="name"' }) : ""}${field("E-mail", "email", "", "email", true, false, { attrs: 'autocomplete="username"' })}${passwordField("f-password", "password", "Senha", register ? "new-password" : "current-password", register ? 'minlength="10" aria-describedby="password-hint"' : "")}${register ? '<p class="hint" id="password-hint">Use pelo menos 10 caracteres. Sua conta terá seus próprios clientes e documentos.</p>' : ""}<div class="error" id="autherror" role="alert"></div><button type="submit" class="primary">${register ? "Criar minha conta" : "Entrar na minha conta"} <span aria-hidden="true">→</span></button><button class="auth-switch" type="button">${register ? "Já tenho uma conta. Entrar" : "Primeiro acesso? Criar uma conta"}</button></form></main></div>`;
  $(".auth-switch").onclick = () => auth(!register);
  const form = $("#authform");
  form.addEventListener("input", (event) => revalidate(event.target));
  form.onsubmit = async (event) => {
    event.preventDefault();
    $("#autherror").textContent = "";
    if (!validateForm(form)) return;
    const button = $('button[type="submit"]', form),
      label = button.innerHTML;
    button.disabled = true;
    button.textContent = register ? "Criando conta…" : "Entrando…";
    try {
      user = await api(
        register ? "/register" : "/login",
        Object.fromEntries(new FormData(form)),
      );
      pendingFocus = "heading";
      await load();
    } catch (error) {
      $("#autherror").textContent = error.message;
      button.disabled = false;
      button.innerHTML = label;
    }
  };
}
function reauthenticate() {
  if (reauthPending) return reauthPending;
  reauthPending = new Promise((resolve, reject) => {
    reauthDialog.innerHTML = `<form id="reauthform" novalidate><div class="modal-head"><h2 id="reauth-title">Sua sessão expirou</h2></div><div class="modal-body"><p class="reauth-text">Entre novamente para continuar. O que você digitou foi mantido.</p><div class="form-grid single"><div class="field full"><label for="reauth-email">E-mail</label><input id="reauth-email" name="email" type="email" value="${esc(user.email)}" autocomplete="username" readonly></div>${passwordField("reauth-password", "password", "Senha", "current-password", "", true)}</div><p class="error" id="reauth-error" role="alert"></p></div><div class="modal-foot"><button type="button" data-reauth-cancel>Cancelar</button><button type="submit" class="primary">Entrar e continuar</button></div></form>`;
    const form = $("#reauthform", reauthDialog);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      reauthPending = null;
      if (reauthDialog.open) reauthDialog.close();
      if (error) reject(error);
      else resolve();
    };
    const cancel = () =>
      finish(
        Object.assign(
          Error(
            "Sua sessão expirou. Entre novamente para salvar: o que você digitou continua no formulário.",
          ),
          { status: 401 },
        ),
      );
    $("[data-reauth-cancel]", form).onclick = cancel;
    reauthDialog.oncancel = (event) => {
      event.preventDefault();
      cancel();
    };
    reauthDialog.onclose = () => {
      if (!settled) cancel();
    };
    form.addEventListener("input", (event) => revalidate(event.target));
    form.onsubmit = async (event) => {
      event.preventDefault();
      $("#reauth-error").textContent = "";
      if (!validateForm(form)) return;
      const button = $('button[type="submit"]', form);
      button.disabled = true;
      try {
        user = await api(
          "/login",
          { email: user.email, password: $("#reauth-password").value },
          { retry: false },
        );
        finish();
      } catch (error) {
        $("#reauth-error").textContent = error.message;
        button.disabled = false;
      }
    };
    reauthDialog.showModal();
    $("#reauth-password").focus();
  });
  return reauthPending;
}
async function load() {
  state = await api("/data");
  render();
}
async function logout() {
  if (pageGuard?.() && !confirm(LEAVE_MESSAGE)) return;
  try {
    await api("/logout", {}, { retry: false });
  } catch {}
  clearDrafts();
  history.replaceState(null, "", "#/");
  route = parseRoute("#/");
  auth();
}

// ---------- Documentos ----------
function docs(type) {
  return state.documents.filter((d) => !type || d.type === type);
}
// Documentos fora do arquivo: os únicos que entram no painel, contagens e agenda.
const activeDocs = (type) => docs(type).filter((d) => !d.archived);
const findDoc = (id) => state.documents.find((d) => d.id === Number(id));
const findClient = (id) =>
  state.clients.find((c) => String(c.id) === String(id));
const contractFor = (quote) =>
  quote &&
  state.documents.find((d) => d.type === "contract" && d.sourceId === quote.id);
const displayStatus = (d) =>
  statusOf(d, { contract: contractFor(d), today: today() });
const docHref = (d) => buildHash({ page: listPageFor(d.type), id: d.id });
const docKind = (d) => (d.type === "quote" ? "Orçamento" : "Contrato");
const docsOfClient = (c) =>
  state.documents.filter(
    (d) => String(d.clientId ?? d.client?.id ?? "") === String(c.id),
  );
function validityNote(d, status) {
  const info = validityInfo(d, status, today());
  return info
    ? `<small class="doc-note ${info.tone}">${info.text}</small>`
    : "";
}
const dateTime = (iso) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
// Histórico gravado pelo servidor; documentos antigos só têm a data de criação.
function historyEvents(d) {
  const list =
    Array.isArray(d.history) && d.history.length
      ? d.history
      : [{ type: "created", at: d.createdAt }];
  const label = (e) =>
    ({
      created: e.fromQuote
        ? `Contrato gerado do orçamento ${e.fromQuote}`
        : e.copiedFrom
          ? `Criado como cópia de ${e.copiedFrom}`
          : "Criado",
      edited: "Editado",
      status: `Situação alterada: ${statusLabel(e.from)} → ${statusLabel(e.to)}`,
      sent: `${e.channel === "whatsapp" ? "Enviado pelo WhatsApp" : e.channel === "share" ? "PDF compartilhado" : "Envio registrado"}${e.to ? " · passou a Enviado" : ""}`,
      converted: `Contrato ${e.number || ""} gerado`.replace("  ", " "),
      archived: "Arquivado",
      restored: "Restaurado",
    })[e.type] || "Atualizado";
  return list
    .filter((e) => e.at)
    .map((e) => ({ at: e.at, text: label(e) }))
    .reverse();
}
const labels = {
  dashboard: "Visão geral",
  quotes: "Orçamentos",
  contracts: "Contratos",
  clients: "Clientes",
  products: "Produtos",
  packages: "Pacotes e preços",
  settings: "Configurações",
};
const newButton = (kind, label, primary = true) =>
  `<button type="button"${primary ? ' class="primary"' : ""} data-new="${kind}"><span aria-hidden="true">＋</span> ${label}</button>`;
const linkButton = (href, label, cls = "") =>
  `<a class="btn${cls ? ` ${cls}` : ""}" href="${href}">${label}</a>`;

function render() {
  pageGuard = null;
  // /#/orcamentos/5 de um contrato vira /#/contratos/5, sem novo item no histórico.
  const doc =
    route.id != null && ["quotes", "contracts"].includes(route.page)
      ? findDoc(route.id)
      : null;
  if (doc && listPageFor(doc.type) !== route.page) {
    route = { ...route, page: listPageFor(doc.type) };
    history.replaceState(null, "", buildHash(route));
  }
  renderedHash = location.hash;
  const view = content(doc);
  document.title = `${view.title} · AOF Studio`;
  root.innerHTML = `<a class="skip-link" href="#conteudo" data-action="skip">Pular para o conteúdo</a><div class="shell">${sidebar()}<div class="main">${topbar(view.crumbs)}<main class="content" id="conteudo" tabindex="-1">${view.html}</main></div></div>${bottomNav()}`;
  if (route.page === "settings") bindSettings();
  const focus = pendingFocus;
  pendingFocus = null;
  if (focus)
    (
      (focus !== "heading" && root.querySelector(focus)) ||
      root.querySelector("h1")
    )?.focus();
}
const NAV = [
  "dashboard",
  "quotes",
  "contracts",
  "clients",
  "products",
  "packages",
  "settings",
];
// Na lista, aria-current="page"; na tela de um documento, a seção fica marcada como "true".
const currentAttr = (k) =>
  route.page !== k
    ? ""
    : route.id == null
      ? ' aria-current="page"'
      : ' aria-current="true"';
function sidebar() {
  const contractCount = activeDocs("contract").length;
  return `<div class="sidebar"><div class="brand"><img class="mark app-icon" src="/aof-studio.ico" alt="" aria-hidden="true"><div class="brand-text">aof<span class="brand-soft">studio</span><small>GESTÃO DE EVENTOS</small></div></div><p class="nav-label" id="nav-label">ESPAÇO DE TRABALHO</p><nav class="nav" aria-labelledby="nav-label">${NAV.map(
    (k) =>
      `<a href="${buildHash({ page: k })}" class="${route.page === k ? "active" : ""}"${currentAttr(k)}>${icon(k)}<span class="label">${labels[k]}</span>${k === "contracts" && contractCount ? `<span class="count">${contractCount}</span>` : ""}</a>`,
  ).join(
    "",
  )}</nav><div class="side-bottom"><div class="userline"><span class="avatar" aria-hidden="true">${initial()}</span><div class="user-meta"><strong>${esc(firstName())}</strong><small>${esc(user.email)}</small></div><button type="button" class="logout" data-action="logout" aria-label="Sair da conta" title="Sair">${icon("logout")}<span>Sair</span></button></div></div></div>`;
}
function topbar(crumbs) {
  const items = crumbs.map((c, i) =>
    i < crumbs.length - 1 && c.href
      ? `<li><a href="${c.href}">${esc(c.label)}</a></li>`
      : `<li><span aria-current="page">${esc(c.label)}</span></li>`,
  );
  return `<header class="topbar"><img class="mark mobile-mark app-icon" src="/aof-studio.ico" alt="" aria-hidden="true"><nav class="crumbs" aria-label="Você está em"><ol>${items.join("")}</ol></nav></header>`;
}
// Celular: barra inferior com rótulos, botão "Novo" e menu "Mais".
function bottomNav() {
  const item = (k, label, ic) =>
    `<a href="${buildHash({ page: k })}" class="tab-item${route.page === k ? " active" : ""}"${currentAttr(k)}>${icon(ic)}<span>${label}</span></a>`;
  const moreActive = ["clients", "products", "packages", "settings"].includes(
    route.page,
  );
  return `<nav class="bottom-nav" aria-label="Navegação principal">${item("dashboard", "Início", "dashboard")}${item("quotes", "Orçamentos", "quotes")}<button type="button" class="tab-item tab-new" popovertarget="new-menu">${icon("plus")}<span>Novo</span></button>${item("contracts", "Contratos", "contracts")}<button type="button" class="tab-item${moreActive ? " active" : ""}" popovertarget="more-menu">${icon("menu")}<span>Mais${moreActive ? `<span class="sr-only">, seção atual: ${labels[route.page]}</span>` : ""}</span></button></nav><div id="new-menu" class="sheet-menu" popover><p class="sheet-title">Criar</p><button type="button" data-new="quote">Novo orçamento</button><button type="button" data-new="contract">Novo contrato</button><button type="button" data-new="client">Novo cliente</button></div><div id="more-menu" class="sheet-menu" popover><a href="#/clientes">Clientes</a><a href="#/produtos">Produtos</a><a href="#/pacotes">Pacotes e preços</a><a href="#/configuracoes">Configurações</a><button type="button" data-action="logout">Sair da conta</button></div>`;
}
function head(title, description, buttons = "") {
  return `<div class="page-head"><div><h1 tabindex="-1">${title}</h1><p>${description}</p></div><div class="actions">${buttons}</div></div>`;
}
const HOME = { label: "Seu espaço", href: "#/" };
const sectionCrumb = (page) => ({
  label: labels[page],
  href: buildHash({ page }),
});
function notFound(title, message, page = "dashboard") {
  return {
    title,
    crumbs:
      page === "dashboard"
        ? [HOME, { label: title }]
        : [HOME, sectionCrumb(page), { label: title }],
    html: `${head(title, message)}${linkButton(buildHash({ page }), page === "dashboard" ? "Ir para a Visão geral" : `Voltar para ${labels[page]}`, "primary")}`,
  };
}
// Cada tela devolve título da aba, trilha de navegação e conteúdo.
function content(doc) {
  const { page, id } = route;
  if (!route.known)
    return notFound(
      "Página não encontrada",
      "Este endereço não corresponde a uma tela do sistema.",
    );
  if (id != null) {
    if (page === "clients") {
      const client = findClient(id);
      return client
        ? clientDetail(client)
        : notFound(
            "Cliente não encontrado",
            "Ele pode ter sido excluído.",
            "clients",
          );
    }
    return doc
      ? docDetail(doc)
      : notFound(
          "Documento não encontrado",
          "Ele pode ter sido excluído definitivamente.",
          page,
        );
  }
  const view = (html) => ({
    title: labels[page],
    crumbs: [HOME, { label: labels[page] }],
    html,
  });
  if (page === "dashboard") return view(dashboard());
  if (page === "settings") return view(settings());
  if (page === "clients")
    return view(
      head(
        "Clientes",
        "Dados de contato usados nos orçamentos e contratos.",
        newButton("client", "Novo cliente"),
      ) +
        toolbar() +
        `<div class="panel" id="list">${clientTable()}</div>`,
    );
  if (page === "products")
    return view(
      head(
        "Produtos",
        "Equipamentos e serviços avulsos. Cada produto define em qual quadro do contrato é impresso.",
        newButton("product", "Novo produto"),
      ) + productList(),
    );
  if (page === "packages")
    return view(
      head(
        "Pacotes e preços",
        "Serviços, equipamentos e valores de referência para os orçamentos.",
        newButton("package", "Novo pacote"),
      ) +
        `<div class="list-cards">${state.packages.map(packageCard).join("") || empty("Seu primeiro pacote", "Cadastre os serviços, equipamentos e o preço de cada experiência.", "package", "Criar pacote")}</div>`,
    );
  const isQ = page === "quotes",
    kind = isQ ? "quote" : "contract";
  return view(
    head(
      isQ ? "Orçamentos" : "Contratos",
      isQ
        ? "Crie propostas, acompanhe a validade e gere contratos."
        : "Revise cláusulas, condições e assinaturas de cada evento.",
      newButton(kind, isQ ? "Novo orçamento" : "Novo contrato"),
    ) +
      toolbar(kind) +
      `<div class="panel" id="list">${docList(kind)}</div>`,
  );
}
// Produtos agrupados pelo quadro do contrato em que aparecem: o cadastro mostra
// o mesmo agrupamento que vai sair impresso.
function productList() {
  if (!state.products.length)
    return `<div class="list-cards">${empty(
      "Monte seu catálogo",
      "Cadastre caixas de som, luzes cênicas, mesas e serviços. Depois use esses produtos para montar pacotes e para acrescentar itens a um orçamento ou contrato.",
      "product",
      "Cadastrar produto",
    )}</div>`;
  const actions = (p) =>
    `<button type="button" data-edit-product="${p.id}">Editar<span class="sr-only"> ${esc(p.name)}</span></button><button type="button" class="danger-outline" data-delete-product="${p.id}">Excluir<span class="sr-only"> ${esc(p.name)}</span></button>`;
  const value = (p) => (Number(p.price) > 0 ? money(p.price) : "—");
  return EQUIPMENT_CATEGORIES.filter((c) =>
    state.products.some((p) => p.category === c.id),
  )
    .map((c) => {
      const list = state.products.filter((p) => p.category === c.id);
      return `<section class="panel product-group"><div class="panel-title"><h2>${esc(c.label)}</h2><span class="count">${list.length}</span></div><p class="hint">No contrato: ${esc(c.title)}</p><div class="table-wrap"><table><thead><tr><th scope="col">Produto</th><th scope="col">Valor de referência</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${list
        .map(
          (p) =>
            `<tr><td>${esc(p.name)}</td><td>${value(p)}</td><td><div class="rowactions">${actions(p)}</div></td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><ul class="doc-cards" aria-label="Produtos de ${esc(c.label)}">${list
        .map(
          (p) =>
            `<li class="doc-card"><div class="doc-card-head"><strong>${esc(p.name)}</strong></div><p class="doc-card-meta"><span>${value(p)}</span></p><div class="rowactions">${actions(p)}</div></li>`,
        )
        .join("")}</ul></section>`;
    })
    .join("");
}
const packageCard = (p) =>
  `<article class="panel package-detail"><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p class="price">${money(p.price)}</p><p class="equipment">${esc(p.equipment)}</p><div class="card-actions"><button type="button" data-edit-package="${p.id}">Editar pacote<span class="sr-only"> ${esc(p.name)}</span></button><button type="button" class="danger-outline" data-delete-package="${p.id}">Excluir<span class="sr-only"> pacote ${esc(p.name)}</span></button></div></article>`;
function quoteGallery() {
  const templates = state.quoteTemplates || QUOTE_TEMPLATES;
  return `<section class="quote-gallery" aria-labelledby="quote-models-title"><div class="quote-gallery-heading"><div><h2 id="quote-models-title">Modelos prontos para impressionar</h2><p>Escolha o espaço, personalize os detalhes e gere um PDF com sua marca.</p></div><span class="quote-gallery-badge">${templates.length} modelos incluídos</span></div><div class="quote-models">${templates
    .map(
      (t, i) =>
        `<article class="quote-model"><div class="quote-model-cover"><img class="quote-model-photo" src="/quote-assets/estrutura.png" alt="" loading="lazy"><div class="quote-model-shade"></div><img class="quote-model-logo" src="/quote-assets/logo.jpg" alt=""><span class="quote-model-number" aria-hidden="true">MODELO ${String(i + 1).padStart(2, "0")}</span><h3 class="quote-model-title">${esc(t.name)}</h3></div><div class="quote-model-body"><p>${esc(t.description)}</p><div class="quote-model-tags"><span>PDF com fotos e marca</span><span>${t.offers.length > 1 ? `${t.offers.length} opções de serviço` : "Pacote completo"}</span></div><button type="button" data-quote-template="${esc(t.id)}">Usar modelo<span class="sr-only"> ${esc(t.name)}</span> ${icon("arrow")}</button></div></article>`,
    )
    .join("")}</div></section>`;
}
const entriesOf = (list) =>
  list.map((doc) => ({ doc, status: displayStatus(doc) }));
const countsFor = (kind) => tabCounts(entriesOf(docs(kind)), TABS[kind]);
function tabsMarkup(kind) {
  const counts = countsFor(kind),
    tabs = [
      ...TABS[kind],
      ...(counts.archived || route.filter === "archived" ? ["archived"] : []),
    ];
  return `<div class="status-tabs" role="group" aria-label="Filtrar por situação">${tabs
    .map(
      (t) =>
        `<button type="button" class="status-tab${route.filter === t ? " active" : ""}" data-filter="${t}" aria-pressed="${route.filter === t}">${TAB_LABELS[t]} <span class="tab-count">${counts[t] ?? 0}</span></button>`,
    )
    .join("")}</div>`;
}
// Abas por situação (com contagem), busca e ordenação; tudo fica no endereço da tela.
function toolbar(kind = null) {
  const sort = kind
    ? `<label class="sort"><span>Ordenar por</span><select id="sort">${Object.entries(
        SORT_LABELS,
      )
        .map(
          ([v, l]) =>
            `<option value="${v}"${route.sort === v ? " selected" : ""}>${l}</option>`,
        )
        .join("")}</select></label>`
    : "";
  return `${kind ? tabsMarkup(kind) : ""}<div class="toolbar" role="search"><label class="sr-only" for="search">Buscar</label><input type="search" id="search" placeholder="${kind ? "Buscar cliente, evento ou nº" : "Buscar nome, e-mail ou telefone"}" value="${esc(route.search)}" autocomplete="off">${sort}<p class="sr-only" id="results-status" role="status"></p></div>`;
}
function empty(title, description, kind, label) {
  return `<div class="empty"><div class="empty-symbol" aria-hidden="true">◇</div><h3>${title}</h3><p>${description}</p>${kind ? newButton(kind, label) : ""}</div>`;
}
function dashboard() {
  const contracts = activeDocs("contract"),
    quotes = activeDocs("quote"),
    active = contracts.filter((d) =>
      ["sent", "approved", "signed"].includes(d.status),
    ),
    closed = contracts.filter((d) => ["approved", "signed"].includes(d.status)),
    open = quotes.filter((d) => ["draft", "sent"].includes(displayStatus(d))),
    soon = open.filter((d) => {
      const days = daysBetween(today(), d.validUntil);
      return days != null && days >= 0 && days <= 3;
    }),
    pk = state.packages[0];
  const card = (label, value, note, iconName, feature = false) =>
    `<div class="card${feature ? " feature" : ""}"><div class="card-top"><span>${label}</span><span class="mini-icon">${icon(iconName)}</span></div><p class="stat">${value}</p><small>${note}</small></div>`;
  return (
    head(
      "Visão geral",
      `Olá${firstName() ? `, ${esc(firstName())}` : ""}. Acompanhe documentos, prazos e próximos eventos.`,
      newButton("contract", "Novo contrato", false) +
        newButton("quote", "Novo orçamento"),
    ) +
    `<div class="cards">${card("Contratos ativos", active.length, "Enviados, aprovados ou assinados", "contracts")}${card(
      "Orçamentos em aberto",
      open.length,
      soon.length
        ? `${soon.length} ${soon.length === 1 ? "vence" : "vencem"} nos próximos 3 dias`
        : "Rascunhos e enviados dentro da validade",
      "quotes",
    )}${card("Clientes cadastrados", state.clients.length, "Disponíveis para novos documentos", "clients")}${card(
      "Valor contratado",
      money(closed.reduce((s, d) => s + Number(d.total), 0)),
      "Contratos aprovados ou assinados",
      "trend",
      true,
    )}</div><div class="grid"><div><section class="panel"><div class="panel-title"><h2>Documentos recentes</h2><div class="panel-links"><a class="link-button" href="#/orcamentos">Orçamentos</a><a class="link-button" href="#/contratos">Contratos</a></div></div>${docEntries(entriesOf(activeDocs().slice(0, 6)), { compact: true, emptyHtml: empty("Sua próxima história começa aqui", "Crie um orçamento, combine os detalhes e transforme em contrato.", "quote", "Criar primeiro orçamento") })}</section><section class="panel panel-gap"><div class="panel-title"><h2>Próximos eventos</h2><span>Contratos com data a partir de hoje</span></div>${eventList()}</section></div><aside class="aside-cards" aria-label="Catálogo de pacotes"><section class="panel"><div class="panel-title"><h2>Seu catálogo de experiências</h2></div>${
      pk
        ? `<div class="package-box"><p class="package-label">EM DESTAQUE</p><h3>${esc(pk.name)}</h3><p class="price">${money(pk.price)}</p><p class="package-desc">${esc(pk.description)}</p><ul>${String(
            pk.equipment || "",
          )
            .split("\n")
            .filter(Boolean)
            .slice(0, 4)
            .map((x) => `<li>${esc(x)}</li>`)
            .join(
              "",
            )}</ul>${linkButton("#/pacotes", "Gerenciar pacotes", "block")}</div>`
        : empty(
            "Monte seu catálogo",
            "Crie seu primeiro pacote.",
            "package",
            "Criar pacote",
          )
    }</section></aside></div>`
  );
}
function eventList() {
  const list = activeDocs("contract")
    .filter((d) => d.date >= today() && d.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  return list.length
    ? `<ul class="event-list">${list
        .map(
          (d) =>
            `<li><span class="badge approved">${date(d.date)}</span><div><a class="row-link" href="${docHref(d)}">${esc(d.event)}</a><small>${esc(d.client?.name)} · ${esc(d.venue || "Local a definir")}</small></div></li>`,
        )
        .join("")}</ul>`
    : empty(
        "A agenda está aberta",
        "Os próximos eventos dos seus contratos aparecerão aqui.",
      );
}
// Lista de uma página (orçamentos ou contratos) com a aba, a busca e a ordem atuais.
function docList(kind) {
  const all = entriesOf(docs(kind));
  if (!all.length)
    return kind === "contract"
      ? empty(
          "Nenhum contrato ainda",
          "Gere um contrato a partir de um orçamento ou crie um do zero.",
          "contract",
          "Novo contrato",
        )
      : `<div class="empty"><div class="empty-symbol" aria-hidden="true">◇</div><h3>Sua próxima história começa aqui</h3><p>Comece por um dos modelos prontos ou crie um orçamento em branco.</p></div>${quoteGallery()}<p class="empty-alt">${newButton("quote", "Começar em branco", false)}</p>`;
  const visible = all.filter(
    (e) => inTab(e, route.filter) && matchesSearch(e.doc, route.search),
  );
  const sorted = sortDocs(
    visible.map((e) => e.doc),
    route.sort,
  ).map((doc) => visible.find((e) => e.doc === doc));
  const emptyHtml =
    route.filter === "archived" && !route.search
      ? '<div class="empty"><h3>Nenhum documento arquivado</h3><p>Documentos arquivados saem das listas e do painel, e podem ser restaurados aqui.</p></div>'
      : '<div class="empty"><h3>Nenhum documento encontrado</h3><p>Nenhum resultado para a busca ou a situação selecionada.</p><button type="button" data-action="clear-filters">Limpar busca e filtros</button></div>';
  return docEntries(sorted, { kind, emptyHtml });
}
// Mesma lista em tabela (computador) e em cartões (celular); o CSS mostra uma das duas.
function docEntries(
  entries,
  { kind = null, compact = false, emptyHtml = "" } = {},
) {
  if (!entries.length) return emptyHtml;
  const numberCol = !compact;
  return `<div class="table-wrap${compact ? " compact" : ""}"><table class="doc-table"><thead><tr><th scope="col">Cliente / evento</th>${numberCol ? '<th scope="col" class="col-num">Nº</th>' : ""}<th scope="col">${compact ? "Data" : "Data do evento"}</th><th scope="col">Valor</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>${entries
    .map((e) => docRow(e, { compact, numberCol }))
    .join(
      "",
    )}</tbody></table></div><ul class="doc-cards" aria-label="${kind ? (kind === "quote" ? "Orçamentos" : "Contratos") : "Documentos"}">${entries.map(docCard).join("")}</ul>`;
}
const rowContext = (d) =>
  `<span class="sr-only">: ${esc(d.client?.name)}, ${esc(d.event)}</span>`;
// Ação principal da linha, conforme o próximo passo provável; as demais ficam no menu "⋯".
function primaryAction(d, status) {
  const ctx = rowContext(d),
    contract = d.type === "quote" ? contractFor(d) : null;
  if (d.archived)
    return `<button type="button" data-restore="${d.id}">Restaurar${ctx}</button>`;
  if (contract)
    return `<a class="btn" href="${docHref(contract)}">Ver contrato${ctx}</a>`;
  if (status === "draft")
    return `<button type="button" class="soft" data-send="${d.id}">Enviar${ctx}</button>`;
  if (d.type === "quote" && ["sent", "approved"].includes(status))
    return `<button type="button" class="soft" data-convert="${d.id}">Gerar contrato${ctx}</button>`;
  if (status === "expired")
    return `<button type="button" data-edit-doc="${d.id}">Editar${ctx}</button>`;
  return `<button type="button" data-preview-pdf="${d.id}">PDF<span class="sr-only"> (abre em nova aba)</span>${ctx} <span aria-hidden="true">↗</span></button>`;
}
const menuButton = (d) =>
  `<button type="button" class="icon-button dots" data-menu="${d.id}" popovertarget="row-menu" aria-label="Mais ações: ${esc(d.client?.name)}, ${esc(d.event)}">${icon("more")}</button>`;
function docRow({ doc: d, status }, { compact, numberCol }) {
  // Na versão compacta (painel e tela do cliente) a origem fica só na tela do documento.
  const source =
    !compact && d.type === "contract" && d.sourceId
      ? findDoc(d.sourceId)
      : null;
  return `<tr data-href="${docHref(d)}"><td><a class="row-link" href="${docHref(d)}">${esc(d.client?.name)}</a><small>${esc(d.event)}${compact ? ` · ${docKind(d)}` : ""} <span class="doc-number${numberCol ? " sub-num" : ""}">${esc(d.number || "")}</span></small>${source ? `<small>Gerado do orçamento <span class="doc-number">${esc(source.number)}</span></small>` : ""}</td>${numberCol ? `<td class="col-num"><span class="doc-number">${esc(d.number || "")}</span></td>` : ""}<td>${date(d.date)}</td><td>${money(d.total)}</td><td>${badge(d.archived ? "archived" : status)}${d.archived ? "" : validityNote(d, status)}</td><td><div class="rowactions">${primaryAction(d, status)}${menuButton(d)}</div></td></tr>`;
}
function docCard({ doc: d, status }) {
  return `<li class="doc-card" data-href="${docHref(d)}"><div class="doc-card-head"><a class="row-link" href="${docHref(d)}">${esc(d.client?.name)}</a>${badge(d.archived ? "archived" : status)}</div><p class="doc-card-sub">${esc(d.event)} · ${docKind(d)} <span class="doc-number">${esc(d.number || "")}</span></p><p class="doc-card-meta"><span>${date(d.date)}</span><strong>${money(d.total)}</strong></p>${d.archived ? "" : validityNote(d, status)}<div class="rowactions">${primaryAction(d, status)}${menuButton(d)}</div></li>`;
}
const clientHref = (c) => buildHash({ page: "clients", id: c.id });
function clientTable() {
  const term = normalizeText(route.search);
  const list = state.clients.filter((c) =>
    normalizeText(`${c.name} ${c.email} ${c.phone}`).includes(term),
  );
  if (!list.length)
    return state.clients.length
      ? '<div class="empty"><h3>Nenhum cliente encontrado</h3><p>Nenhum resultado para a busca.</p><button type="button" data-action="clear-filters">Limpar busca</button></div>'
      : empty(
          "Conheça seu próximo cliente",
          "Cadastre nome, contato e os dados necessários para os documentos.",
          "client",
          "Cadastrar cliente",
        );
  const count = (c) => {
    const n = docsOfClient(c).filter((d) => !d.archived).length;
    return n
      ? `${n} ${n === 1 ? "documento" : "documentos"}`
      : "Nenhum documento";
  };
  const edit = (c) =>
    `<button type="button" data-edit-client="${c.id}">Editar<span class="sr-only"> ${esc(c.name)}</span></button>`;
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Contato</th><th scope="col">CPF / CNPJ</th><th scope="col">Documentos</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${list
    .map(
      (c) =>
        `<tr data-href="${clientHref(c)}"><td><a class="row-link" href="${clientHref(c)}">${esc(c.name)}</a></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.document)}</td><td>${count(c)}</td><td>${edit(c)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><ul class="doc-cards" aria-label="Clientes">${list
    .map(
      (c) =>
        `<li class="doc-card" data-href="${clientHref(c)}"><div class="doc-card-head"><a class="row-link" href="${clientHref(c)}">${esc(c.name)}</a></div><p class="doc-card-sub">${esc([c.phone, c.email].filter(Boolean).join(" · ") || "Sem contato cadastrado")}</p><p class="doc-card-meta"><span>${count(c)}</span></p><div class="rowactions">${edit(c)}</div></li>`,
    )
    .join("")}</ul>`;
}
// Atualiza só a lista (sem redesenhar a página) e guarda filtros no endereço, sem novo item no histórico.
function refreshList() {
  history.replaceState(null, "", buildHash(route));
  renderedHash = location.hash;
  const list = $("#list");
  if (!list) return;
  if (route.page === "clients") list.innerHTML = clientTable();
  else {
    const kind = route.page === "quotes" ? "quote" : "contract",
      tabs = $(".status-tabs");
    list.innerHTML = docList(kind);
    tabs?.replaceWith(
      document.createRange().createContextualFragment(tabsMarkup(kind)),
    );
  }
  const rows = $$("tbody tr", list).length,
    status = $("#results-status");
  if (status)
    status.textContent = rows
      ? `${rows} ${rows === 1 ? "resultado" : "resultados"}`
      : "Nenhum resultado";
}

// ---------- Configurações ----------
function settings() {
  const c = state.settings;
  return (
    head(
      "Configurações",
      "Dados da empresa, contato e cláusulas usados nos novos documentos.",
    ) +
    `<section class="panel settings-panel"><div class="notice">As cláusulas foram adaptadas dos documentos enviados. Revise o texto com assessoria jurídica antes do uso. Alterações aqui valem para novos documentos; os já emitidos mantêm os dados registrados.</div><form id="settingsform" novalidate><div class="form-alerts"></div>${LEGEND}<div class="form-grid">${field("Empresa", "company", c.company, "text", true, false, { attrs: 'autocomplete="organization"' })}${field("Representante", "representative", c.representative, "text", false, false, { attrs: 'autocomplete="name"' })}${field("CNPJ", "cnpj", maskDocument(c.cnpj), "text", false, false, { attrs: 'data-mask="document" autocomplete="off"' })}${field("E-mail", "email", c.email, "email", false, false, { attrs: 'autocomplete="email"' })}${field("WhatsApp comercial", "phone", maskPhone(c.phone), "tel", true, false, { attrs: 'data-mask="phone" autocomplete="tel"', hint: "Aparece no orçamento para o cliente confirmar a contratação." })}${field("Chave PIX", "pix", c.pix, "text", false, false, { attrs: 'autocomplete="off"', hint: "Aparece no orçamento junto com as instruções para contratar." })}${field("Endereço", "address", c.address, "text", false, true, { attrs: 'autocomplete="street-address"' })}${field("Validade padrão dos orçamentos (dias)", "quoteValidityDays", c.quoteValidityDays ?? DEFAULT_VALIDITY_DAYS, "number", true, false, { attrs: 'min="1" max="365" step="1" inputmode="numeric"', hint: "Sugere a data de validade de cada novo orçamento." })}${section("Logos dos PDFs")}<p class="hint full">Escolha uma logo para cada tipo de documento nesta conta. As imagens serão usadas nos novos documentos; os já emitidos preservam a logo registrada na criação. PNG, JPG ou ICO, até 5 MB.</p>${logoField("Logo dos orçamentos", "quoteLogoDataUrl", c.quoteLogoDataUrl, "/quote-assets/logo.jpg")}${logoField("Logo dos contratos", "contractLogoDataUrl", c.contractLogoDataUrl, "/quote-assets/logo-contrato.jpg")}${area("Cláusulas padrão (editáveis)", "clauses", c.clauses, true, { attrs: 'rows="16"' })}</div><button type="submit" class="primary settings-save">Salvar configurações</button></form></section>`
  );
}
function logoField(label, name, value, fallback) {
  return `<div class="field logo-setting" data-logo-setting="${name}" data-logo-default="${fallback}"><label for="f-upload-${name}">${label}</label><div class="logo-preview"><img src="${esc(value || fallback)}" alt="Prévia: ${label.toLowerCase()}"></div><input type="hidden" id="f-${name}" name="${name}" value="${esc(value || "")}"><input class="logo-upload" id="f-upload-${name}" type="file" accept=".png,.jpg,.jpeg,.ico,image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon" aria-describedby="logo-status-${name} logo-error-${name}"><p class="hint logo-status" id="logo-status-${name}" role="status">${value ? "Logo personalizada nesta conta." : "Logo padrão do sistema."}</p><button type="button" data-reset-logo${value ? "" : " disabled"}>Usar logo padrão</button><p class="field-error" id="logo-error-${name}" role="alert"></p></div>`;
}
async function prepareLogo(file) {
  if (file.size > 5 * 1024 * 1024)
    throw Error("A imagem deve ter até 5 MB. Escolha um arquivo menor.");
  if (
    !/\.(png|jpe?g|ico)$/i.test(file.name) ||
    ![
      "",
      "image/png",
      "image/jpeg",
      "image/x-icon",
      "image/vnd.microsoft.icon",
    ].includes(file.type)
  )
    throw Error("Escolha uma imagem PNG, JPG ou ICO.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(
          Error(
            "Não foi possível abrir essa imagem. Exporte a logo como PNG ou JPG e tente novamente.",
          ),
        );
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw Error("A imagem não possui dimensões válidas.");
    const scale = Math.min(
      1,
      512 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw Error(
        "Seu navegador não conseguiu preparar a imagem. Tente novamente em outro navegador.",
      );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const withinLimit = (data) => atob(data.split(",")[1]).length <= 256 * 1024;
    let data = canvas.toDataURL("image/png");
    if (withinLimit(data)) return data;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 255) {
        transparent = true;
        break;
      }
    }
    if (!transparent) {
      for (const quality of [0.92, 0.85, 0.75, 0.65]) {
        data = canvas.toDataURL("image/jpeg", quality);
        if (withinLimit(data)) return data;
      }
    }
    throw Error(
      "A imagem continua muito grande após o ajuste. Use uma logo mais simples ou menor, mantendo a transparência em PNG.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
function bindSettings() {
  const form = $("#settingsform");
  if (!form) return;
  const initialState = comparable(form);
  pageGuard = () => comparable(form) !== initialState;
  const host = $(".form-alerts", form);
  let pendingUploads = 0;
  for (const card of $$("[data-logo-setting]", form)) {
    const input = $("[type=file]", card),
      value = $("[type=hidden]", card),
      preview = $("img", card),
      reset = $("[data-reset-logo]", card),
      status = $(".logo-status", card),
      error = $(".field-error", card);
    reset.onclick = () => {
      value.value = "";
      input.value = "";
      preview.src = card.dataset.logoDefault;
      reset.disabled = true;
      status.textContent =
        "Logo padrão do sistema. Salve para aplicar aos novos documentos.";
      error.textContent = "";
    };
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      pendingUploads++;
      input.disabled = reset.disabled = true;
      $('button[type="submit"]', form).disabled = true;
      error.textContent = "";
      status.textContent = "Preparando imagem…";
      try {
        const data = await prepareLogo(file);
        value.value = data;
        preview.src = data;
        status.textContent =
          "Logo personalizada pronta. Salve para aplicar aos novos documentos.";
      } catch (cause) {
        error.textContent =
          cause.message ||
          "Não foi possível preparar a imagem. Escolha outro arquivo.";
        status.textContent = value.value
          ? "A logo personalizada anterior foi preservada."
          : "A logo padrão foi preservada.";
      } finally {
        pendingUploads--;
        input.disabled = false;
        input.value = "";
        reset.disabled = !value.value;
        $('button[type="submit"]', form).disabled = pendingUploads > 0;
      }
    };
  }
  form.addEventListener("input", (event) => revalidate(event.target));
  form.addEventListener("change", (event) => revalidate(event.target));
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (pendingUploads) return;
    if (!validateForm(form, { host })) return;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    button.textContent = "Salvando…";
    try {
      const values = Object.fromEntries(new FormData(form));
      await api("/records/settings", {
        ...state.settings,
        ...values,
        quoteLogoDataUrl: values.quoteLogoDataUrl || null,
        contractLogoDataUrl: values.contractLogoDataUrl || null,
        quoteValidityDays: Number(values.quoteValidityDays),
        id: state.settings.id,
      });
      pageGuard = null;
      pendingFocus = "heading";
      await load();
      toast("Configurações salvas.");
    } catch (error) {
      showSummary(
        host,
        [{ message: error.message }],
        "Não foi possível salvar",
      );
      button.disabled = false;
      button.textContent = "Salvar configurações";
    }
  };
}

// ---------- Modal de formulário ----------
// Formulário em diálogo. `dialog` permite abrir um segundo formulário por cima
// (por exemplo, cadastrar um cliente sem fechar o orçamento).
function openModal(
  title,
  html,
  onSubmit,
  {
    onSaved,
    submitLabel = "Salvar",
    draft = null,
    notice = "",
    dialog = modal,
    successMessage = "Salvo com sucesso.",
    legend = true,
  } = {},
) {
  const returnFocus = focusSelector(document.activeElement),
    titleId = `${dialog.id}-title`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.innerHTML = `<form id="${dialog.id}-form" novalidate><div class="modal-head"><h2 id="${titleId}">${title}</h2><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div><div class="modal-body"><div class="form-alerts"></div>${notice ? `<div class="modal-notice">${notice}</div>` : ""}${legend ? LEGEND : ""}<div class="form-grid">${html}</div></div><div class="modal-foot"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">${submitLabel}</button></div></form>`;
  const form = $("form", dialog),
    alerts = $(".form-alerts", form);
  let pristine = "";
  const saveDraftNow = () => {
    if (!draft || forms.get(dialog) !== ctrl) return;
    try {
      if (ctrl.isDirty())
        localStorage.setItem(
          draft,
          JSON.stringify({ savedAt: Date.now(), values: formValues(form) }),
        );
      else localStorage.removeItem(draft);
    } catch {}
  };
  const saveDraft = debounce(saveDraftNow, 400);
  const ctrl = {
    form,
    dialog,
    alerts,
    close: () => close(),
    extraValidation: () => [],
    markPristine: () => (pristine = comparable(form)),
    isDirty: () => comparable(form) !== pristine,
    changed: () => saveDraft(),
    discardDraft: () => {
      if (!draft) return;
      try {
        localStorage.removeItem(draft);
      } catch {}
    },
    offerDraft(restore) {
      const saved = draft && readDraft(draft);
      if (!saved) return;
      const when = new Date(saved.savedAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const box = document.createElement("div");
      box.className = "draft-notice";
      box.setAttribute("role", "status");
      alerts.append(box);
      requestAnimationFrame(() => {
        box.innerHTML = `<p>Há alterações não salvas deste formulário (${esc(when)}).</p><div class="draft-actions"><button type="button" data-draft="restore">Restaurar alterações</button><button type="button" data-draft="discard">Descartar</button></div>`;
      });
      box.addEventListener("click", (event) => {
        const action = event.target.closest("[data-draft]")?.dataset.draft;
        if (!action) return;
        if (action === "restore") {
          restore(saved.values);
          saveDraftNow();
        } else ctrl.discardDraft();
        box.remove();
        $(
          ".form-grid input, .form-grid select, .form-grid textarea",
          form,
        )?.focus();
      });
    },
  };
  forms.set(dialog, ctrl);
  const close = () => {
    ctrl.discardDraft();
    forms.delete(dialog);
    if (dialog.open) dialog.close();
  };
  const requestClose = () => {
    if (!ctrl.isDirty() || confirm(DISCARD_MESSAGE)) close();
  };
  $$("[data-close]", form).forEach((button) => (button.onclick = requestClose));
  dialog.oncancel = (event) => {
    if (forms.get(dialog) !== ctrl) return;
    if (!ctrl.isDirty()) return ctrl.discardDraft();
    if (event.cancelable) {
      event.preventDefault();
      requestClose();
      return;
    }
    // O navegador pode impedir o cancelamento do Esc repetido: o rascunho fica guardado.
    saveDraftNow();
    forms.delete(dialog);
    if (draft)
      setTimeout(
        () =>
          toast(
            "Formulário fechado. Suas alterações ficaram guardadas como rascunho neste navegador.",
          ),
        0,
      );
  };
  dialog.onclose = () => {
    if (forms.get(dialog) === ctrl && !dialog.open) forms.delete(dialog);
  };
  form.addEventListener("input", (event) => {
    revalidate(event.target);
    saveDraft();
  });
  form.addEventListener("change", (event) => {
    revalidate(event.target);
    saveDraft();
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!validateForm(form, { host: alerts, extra: ctrl.extraValidation() }))
      return;
    const button = $('button[type="submit"]', form),
      label = button.textContent;
    button.disabled = true;
    button.textContent = "Salvando…";
    try {
      const saved = await onSubmit(Object.fromEntries(new FormData(form)));
      close();
      pendingFocus = returnFocus || "heading";
      await load();
      if (successMessage) toast(successMessage);
      onSaved?.(saved);
    } catch (error) {
      if (dialog.open)
        showSummary(
          alerts,
          [{ message: error.message }],
          "Não foi possível salvar",
        );
      else toast(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };
  dialog.showModal();
  ctrl.markPristine();
  return ctrl;
}
function editClient(c = {}, onSaved, { notice = "", dialog = modal } = {}) {
  return openModal(
    c.id ? "Editar cliente" : "Novo cliente",
    field("Nome completo", "name", c.name, "text", true, false, {
      attrs: 'autocomplete="off"',
    }) +
      field(
        "CPF / CNPJ",
        "document",
        maskDocument(c.document),
        "text",
        false,
        false,
        {
          attrs: 'data-mask="document" autocomplete="off"',
          hint: "Usado no contrato. Não aparece no orçamento.",
        },
      ) +
      field("E-mail", "email", c.email, "email", false, false, {
        attrs: 'autocomplete="off"',
      }) +
      field(
        "Telefone / WhatsApp",
        "phone",
        maskPhone(c.phone),
        "tel",
        false,
        false,
        {
          attrs: 'data-mask="phone" autocomplete="off"',
        },
      ) +
      field("Endereço completo", "address", c.address, "text", false, true, {
        attrs: 'autocomplete="off"',
        hint: "Usado no contrato.",
      }),
    (b) => api("/records/clients", { ...b, id: c.id }),
    {
      onSaved,
      submitLabel: "Salvar cliente",
      notice,
      dialog,
      successMessage: c.id ? "Cliente salvo." : "Cliente cadastrado.",
    },
  );
}
function editProduct(p = {}) {
  openModal(
    p.id ? "Editar produto" : "Novo produto",
    field("Nome do produto", "name", p.name, "text", true, true, {
      hint: "Como deve sair impresso no contrato. Ex.: Moving head Beam 200.",
    }) +
      select(
        "Quadro no contrato",
        "category",
        EQUIPMENT_CATEGORIES.map((c) => [c.id, c.label]),
        p.category || "other",
        true,
        {
          full: true,
          hint: "Define em qual coluna do quadro de equipamentos o item é impresso.",
        },
      ) +
      moneyField("Valor de referência", "price", p.price, false, {
        hint: "Opcional. Serve para somar os itens e comparar com o preço do pacote; não aparece nos documentos.",
      }),
    (b) =>
      api("/records/products", {
        ...b,
        id: p.id,
        price: parseMoney(b.price) ?? 0,
      }),
    { submitLabel: "Salvar produto" },
  );
}
async function deleteProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmAction({
    title: "Excluir produto?",
    message: `<strong>${esc(p.name)}</strong> sai do catálogo. Pacotes, orçamentos e contratos que já usam este item continuam com o nome e o quadro gravados. Esta ação não pode ser desfeita.`,
    confirmLabel: "Excluir produto",
  });
  if (!ok) return;
  try {
    await api(`/records/products/${id}`, null, { method: "DELETE" });
  } catch (error) {
    return toast(error.message, "error");
  }
  pendingFocus = "heading";
  await load();
  toast(`Produto ${p.name} excluído.`);
}

// ---------- Itens do catálogo, em pacotes e em documentos ----------
// O item guarda nome e quadro junto da escolha: editar ou excluir o produto
// depois não muda um documento já emitido.
// Lê as linhas de itens do formulário. Usado ao salvar e para guardar o rascunho.
function readItemRows(form) {
  return $$(".item-row", form).map((row) => {
    const select = $("[data-item-product]", row),
      option = select.selectedOptions[0];
    return {
      productId: /^\d+$/.test(option?.dataset.productId || select.value)
        ? Number(option?.dataset.productId || select.value)
        : null,
      name: option?.dataset.name || "",
      category: option?.dataset.category || "other",
      qty: Number($("[data-item-qty]", row).value) || 1,
      price: Number(option?.dataset.price) || 0,
    };
  });
}
function itemsBlock(hint) {
  const empty = !state.products.length;
  return `<div class="field full items" id="items-field"><span class="label" id="items-label">Itens do catálogo</span><p class="hint" id="items-hint">${hint}${empty ? " Nenhum produto cadastrado ainda: cadastre em <strong>Produtos</strong> para montar a lista por aqui." : ""}</p><div class="item-head" id="item-head" aria-hidden="true" hidden><span>Produto</span><span>Qtd.</span><span>Quadro no contrato</span><span></span></div><div id="items" role="group" aria-labelledby="items-label" aria-describedby="items-hint"></div><p class="items-sum" id="items-sum"></p><div class="item-actions"><button type="button" id="additem"${empty ? " disabled" : ""}><span aria-hidden="true">＋</span> Adicionar item</button></div></div>`;
}
function bindItems(ctrl, initial = []) {
  const form = ctrl.form,
    list = $("#items", form);
  if (!list) return { read: () => [], fill: () => {}, count: () => 0 };
  const options = (item) => {
    const current =
      item?.productId == null
        ? null
        : state.products.find((p) => p.id === Number(item.productId));
    const useSnapshot =
      Boolean(item?.name) &&
      (!current ||
        current.name !== item.name ||
        (current.category || "other") !== (item.category || "other") ||
        (Number(current.price) || 0) !== (Number(item.price) || 0));
    const out = state.products.map(
      (p) =>
        `<option value="${p.id}" data-name="${esc(p.name)}" data-category="${esc(p.category || "other")}" data-price="${Number(p.price) || 0}"${!useSnapshot && current?.id === p.id ? " selected" : ""}>${esc(p.name)}</option>`,
    );
    // Mantém os dados gravados até o usuário escolher explicitamente um produto.
    if (useSnapshot)
      out.unshift(
        `<option value="snapshot" data-product-id="${esc(item.productId ?? "")}" data-name="${esc(item.name)}" data-category="${esc(item.category || "other")}" data-price="${Number(item.price) || 0}" selected>${esc(item.name)} (${current ? "dados gravados" : "fora do catálogo"})</option>`,
      );
    return out.join("");
  };
  const showCategory = (row) => {
    const option = $("[data-item-product]", row).selectedOptions[0];
    $("[data-item-category]", row).textContent = option
      ? categoryLabel(option.dataset.category)
      : "";
  };
  const read = () => readItemRows(form);
  const refresh = () => {
    const rows = $$(".item-row", list);
    rows.forEach((row, i) => {
      $("[data-item-product]", row).setAttribute(
        "aria-label",
        `Produto do item ${i + 1}`,
      );
      $("[data-item-qty]", row).setAttribute(
        "aria-label",
        `Quantidade do item ${i + 1}`,
      );
      $("[data-remove-item]", row).setAttribute(
        "aria-label",
        `Remover o item ${i + 1}`,
      );
    });
    $("#item-head", form).hidden = !rows.length;
    const total = itemsTotal(read());
    $("#items-sum", form).textContent = rows.length
      ? total > 0
        ? `${rows.length} ${rows.length === 1 ? "item" : "itens"} · soma dos valores de referência: ${money(total)}. O preço é definido à parte.`
        : `${rows.length} ${rows.length === 1 ? "item" : "itens"}.`
      : "";
  };
  const addRow = (item = {}) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<select data-item-product>${options(item)}</select><input type="number" min="1" max="999" step="1" inputmode="numeric" value="${Number(item.qty) || 1}" data-item-qty><span class="item-category" data-item-category></span><button type="button" class="icon-button" data-remove-item>×</button>`;
    list.append(row);
    showCategory(row);
    refresh();
    return row;
  };
  $("#additem", form).onclick = () => {
    $("[data-item-product]", addRow()).focus();
    ctrl.changed();
  };
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-item]");
    if (!button) return;
    button.closest(".item-row").remove();
    refresh();
    ctrl.changed();
    ($("[data-remove-item]", list) || $("#additem", form)).focus();
  });
  list.addEventListener("change", (event) => {
    const row = event.target.closest(".item-row");
    if (row) showCategory(row);
    refresh();
  });
  list.addEventListener("input", refresh);
  const fill = (items) => {
    list.innerHTML = "";
    for (const item of items || []) addRow(item);
    refresh();
  };
  fill(initial);
  return { read, fill, count: () => $$(".item-row", list).length };
}
function editPackage(p = {}) {
  const items = p.items || [];
  // Pacote antigo, só com a lista em texto: o texto vira o campo de itens soltos,
  // para nada ser perdido ao passar a usar o catálogo.
  const extra = p.equipmentExtra ?? (items.length ? "" : (p.equipment ?? ""));
  const ctrl = openModal(
    p.id ? "Editar pacote" : "Novo pacote",
    field("Nome do pacote", "name", p.name, "text", true) +
      moneyField("Preço", "price", p.price, true) +
      area("Descrição", "description", p.description) +
      itemsBlock(
        "Monte o pacote com os produtos do catálogo. O quadro de cada item vem do cadastro do produto.",
      ) +
      area("Outros itens", "equipmentExtra", extra, true, {
        hint: "Uma linha por item, para o que não está no catálogo. Ex.: Transporte e montagem.",
      }),
    (b) => {
      const chosen = cleanItems(list.read());
      return api("/records/packages", {
        ...b,
        id: p.id,
        price: parseMoney(b.price),
        items: chosen,
        equipmentExtra: String(b.equipmentExtra || "").trim(),
        equipment: equipmentText(chosen, b.equipmentExtra),
      });
    },
    { submitLabel: "Salvar pacote" },
  );
  const list = bindItems(ctrl, items);
  ctrl.markPristine();
}
// Sem clientes cadastrados, o próprio campo Cliente oferece o cadastro (sem sair do formulário).
// Ficha do evento no PDF do contrato (formato do modelo da AOF). Todos opcionais.
const CONTRACT_SHEET_FIELDS = [
  [
    "referral",
    "Indicação",
    { hint: "Como o cliente chegou: Instagram, indicação de alguém…" },
  ],
  ["contact2", "Segundo contato", { hint: "Ex.: (47) 99999-9999 - Noivo" }],
  [
    "reception",
    "Recepção",
    { full: true, hint: "Local, horário e endereço da recepção." },
  ],
  ["ceremonyPlace", "Local da cerimônia"],
  ["officiant", "Celebrante"],
  ["venueManager", "Gerente do espaço"],
  ["planner", "Cerimonial"],
  ["bartender", "Bartender"],
  ["decoration", "Decoração"],
  ["photo", "Foto"],
  ["video", "Vídeo"],
  ["sweets", "Doces"],
];
function editDoc(type, d = {}, { notice = "", draftId } = {}) {
  const isQuote = type === "quote",
    isNew = !d.id,
    templates = state.quoteTemplates || QUOTE_TEMPLATES,
    // Novo orçamento começa sem modelo: local e preços do modelo só entram por escolha explícita.
    template = isQuote
      ? templates.find((t) => t.id === d.templateId)
      : undefined,
    initialOffer =
      template?.offers.find((o) => o.id === d.offerId) || template?.offers[0],
    p = state.packages[0] || {};
  const cardTerms = (price, count) =>
    price != null && count > 0
      ? `Até ${count}x de ${money(price / count)} no cartão.`
      : "Condições de parcelamento a combinar.";
  const offerPaymentNotes = (offer) =>
    offer.id === "complete"
      ? "À vista: parcela única na assinatura. Boleto: condições a combinar, com quitação até 10 dias antes do evento."
      : "Condições de pagamento a combinar.";
  const templateDefaults = (t, offer) => ({
    templateId: t.id,
    offerId: offer.id,
    quoteHeadline: t.headline,
    introduction: t.introduction,
    venue: t.venue,
    packageId: "",
    packageName: offer.name,
    // Os modelos descrevem os equipamentos em texto; viram itens soltos, e o
    // catálogo entra por cima quando o usuário acrescenta produtos.
    equipmentExtra: offer.equipment,
    cashTotal: offer.cashPrice,
    installmentTotal: offer.installmentPrice,
    installmentCount: offer.installmentCount,
    paymentChoice: "cash",
    cardTerms:
      offer.installmentPrice == null
        ? ""
        : cardTerms(offer.installmentPrice, offer.installmentCount),
    total: offer.cashPrice,
    paymentNotes: offerPaymentNotes(offer),
    notes: [offer.description, t.reservationNotes].filter(Boolean).join("\n\n"),
  });
  const data =
    template && isNew
      ? { ...templateDefaults(template, initialOffer), ...d }
      : { ...d };
  // Documento novo herda os itens do pacote de referência; documento antigo, que
  // só tem a lista em texto, mostra esse texto como itens soltos, sem perder nada.
  const initialItems =
    data.items ?? (isNew && !template ? p.items : null) ?? [];
  const initialExtra =
    data.equipmentExtra ??
    (isNew ? p.equipmentExtra : null) ??
    (initialItems.length ? "" : (data.equipment ?? p.equipment ?? ""));
  if (isQuote && isNew && !data.validUntil)
    data.validUntil = addDays(today(), validityDays());
  // Sem cliente pré-selecionado: a escolha é sempre explícita.
  const selectedClientId = d.clientId ?? d.client?.id ?? "";
  const num = (index) => String(isQuote ? index + 1 : index).padStart(2, "0");
  const quoteFields = isQuote
    ? `${section("01 · Modelo do orçamento")}${select(
        "Modelo visual",
        "templateId",
        [
          ["", "Personalizado (sem modelo)"],
          ...templates.map((t) => [t.id, t.name]),
        ],
        template?.id || "",
        false,
        {
          full: true,
          hint: "Os modelos trazem marca, foto da estrutura, local e condições comerciais. Todos os valores continuam editáveis.",
        },
      )}<div class="quote-template-fields" id="quote-template-fields"${template ? "" : " hidden"}>${select(
        "Opção de serviço do modelo",
        "offerId",
        (template?.offers || []).map((o) => [o.id, o.name]),
        data.offerId || initialOffer?.id,
      )}${field("Título da proposta", "quoteHeadline", data.quoteHeadline || template?.headline)}${area(
        "Apresentação",
        "introduction",
        data.introduction,
        true,
        { hint: "Personalize com os nomes, a data e o local do evento." },
      )}</div>`
    : "";
  const quotePriceFields = isQuote
    ? `<div class="quote-template-fields" id="quote-price-fields"${template ? "" : " hidden"}>${moneyField("Valor à vista", "cashTotal", data.cashTotal, true)}${moneyField(
        "Valor total parcelado",
        "installmentTotal",
        data.installmentTotal,
        false,
        { hint: "Opcional. Deixe em branco se não houver parcelamento." },
      )}${field(
        "Máximo de parcelas no cartão",
        "installmentCount",
        data.installmentCount ?? 0,
        "number",
        true,
        false,
        {
          attrs: 'min="0" max="36" step="1" inputmode="numeric"',
          hint: "Use 0 para parcelamento a combinar.",
        },
      )}${select(
        "Condição escolhida para este orçamento",
        "paymentChoice",
        [
          ["cash", "À vista"],
          ["installments", "Parcelado"],
        ],
        data.paymentChoice || "cash",
      )}${area("Condições do cartão (editáveis)", "cardTerms", data.cardTerms)}<p class="helper full" id="quote-payment-helper"></p></div>`
    : "";
  const paymentsBlock = `<div class="field full payments" id="payments-field"><span class="label" id="payments-label">Vencimentos do pagamento <span class="optional">(opcional)</span></span><p class="hint" id="payments-hint">Registre pagamentos já combinados. A soma precisa ser igual ao total do documento.${isQuote ? " Nas condições de cartão dos modelos, os vencimentos não são obrigatórios." : ""}</p><div class="payment-head" id="payment-head" aria-hidden="true" hidden><span>Vencimento</span><span>Valor</span></div><div id="payments" role="group" aria-labelledby="payments-label" aria-describedby="payments-hint payment-sum"></div><p class="payment-sum" id="payment-sum"></p><div class="payment-actions"><button type="button" id="addpayment"><span aria-hidden="true">＋</span> Adicionar parcela</button><button type="button" id="splitpayments" hidden>Distribuir o total igualmente</button></div></div>`;
  // Recolhida quando vazia, para não alongar o formulário de quem não usa.
  const sheetFields =
    type === "contract"
      ? `<div class="field full"><details class="more-fields" id="more-fields"${CONTRACT_SHEET_FIELDS.some(([name]) => data[name]) ? " open" : ""}><summary>Ficha do evento no contrato <span class="optional">(opcional)</span></summary><p class="hint">Indicação, recepção, cerimônia e equipe do evento aparecem na tabela do contrato. O que ficar vazio sai em branco no PDF.</p><div class="form-grid">${CONTRACT_SHEET_FIELDS.map(
          ([name, label, opts = {}]) =>
            field(
              label,
              name,
              data[name] ?? "",
              "text",
              false,
              Boolean(opts.full),
              { attrs: 'autocomplete="off"', hint: opts.hint || "" },
            ),
        ).join("")}</div></details></div>`
      : "";
  const html = `${quoteFields}${section(`${num(1)} · Cliente e evento`)}${clientCombo(selectedClientId, d.client)}${select(
    "Situação",
    "status",
    Object.entries(statuses).filter(
      ([v]) => type === "contract" || v !== "signed",
    ),
    d.status || "draft",
  )}${field("Nome do evento", "event", data.event, "text", true)}${field("Data do evento", "date", data.date, "date", true)}${field(
    "Local / endereço do evento",
    "venue",
    data.venue,
    "text",
    false,
    true,
  )}${field("Convidados", "guests", data.guests, "number", false, false, {
    attrs: 'min="0" step="1" inputmode="numeric"',
  })}${field("Montagem", "setup", data.setup, "time")}${field("Cerimônia", "ceremony", data.ceremony, "time")}${field(
    "Início da festa",
    "start",
    data.start,
    "time",
  )}${field("Término", "end", data.end, "time", false, false, { hint: "Pode ser no dia seguinte." })}${sheetFields}${section(
    `${num(2)} · Serviços e valores`,
  )}${select(
    "Pacote de referência",
    "packageId",
    [["", "Personalizado"], ...state.packages.map((pk) => [pk.id, pk.name])],
    template ? "" : isNew ? (data.packageId ?? p.id) : data.packageId,
  )}${field("Nome do pacote / serviço", "packageName", data.packageName ?? p.name, "text", true)}${itemsBlock(
    `Escolha os produtos deste evento. O quadro de cada item vem do cadastro do produto e define onde ele é impresso no contrato.`,
  )}${area("Outros itens", "equipmentExtra", initialExtra, true, {
    hint: "Uma linha por item, para o que não está no catálogo.",
  })}${quotePriceFields}${moneyField("Valor total do documento", "total", data.total ?? p.price, true)}${moneyField(
    "Hora adicional",
    "extraHour",
    data.extraHour ?? 500,
  )}${
    isQuote
      ? field(
          "Validade do orçamento",
          "validUntil",
          data.validUntil,
          "date",
          true,
          false,
          {
            hint: "Depois desta data, o orçamento aparece como Vencido.",
          },
        )
      : ""
  }${paymentsBlock}${area("Forma de pagamento e condições", "paymentNotes", data.paymentNotes ?? "Pagamento via PIX ou dinheiro.")}${section(
    `${num(3)} · Condições do documento`,
  )}${
    type === "contract"
      ? area(
          "Cláusulas contratuais (revise antes de emitir)",
          "clauses",
          data.clauses ?? state.settings.clauses,
          true,
          {
            attrs: 'rows="16"',
          },
        )
      : ""
  }${
    type === "contract"
      ? `<div class="field full"><label class="check"><input type="checkbox" name="imageConsent"${data.imageConsent ? " checked" : ""}> O cliente autorizou expressamente o uso de imagem</label><p class="hint">Marque “Assinado” apenas após coletar a assinatura. O sistema gera PDFs; não realiza assinatura eletrônica.</p></div>`
      : ""
  }${area("Observações adicionais", "notes", data.notes)}`;
  const onSubmit = async (b) => {
    const payments = $$(".payment-row", modal).map((row) => ({
      date: $('[type="date"]', row).value,
      amount: parseMoney($("[data-money]", row).value),
    }));
    const client =
      d.id && String(d.clientId ?? d.client?.id) === b.clientId && d.client
        ? d.client
        : state.clients.find((c) => String(c.id) === b.clientId);
    const optionalMoney = (value) => {
      const number = parseMoney(value);
      return number == null || Number.isNaN(number) ? null : number;
    };
    const optionalNumber = (value) =>
      value == null || value === "" ? null : Number(value);
    const selectedTemplate =
      isQuote && templates.find((t) => t.id === b.templateId);
    const quoteValues = isQuote
      ? {
          templateId: selectedTemplate?.id || null,
          offerId: selectedTemplate ? b.offerId || null : null,
          quoteHeadline: selectedTemplate
            ? b.quoteHeadline?.trim() || null
            : null,
          introduction: selectedTemplate
            ? b.introduction?.trim() || null
            : null,
          cashTotal: selectedTemplate ? optionalMoney(b.cashTotal) : null,
          installmentTotal: selectedTemplate
            ? optionalMoney(b.installmentTotal)
            : null,
          installmentCount: selectedTemplate
            ? optionalNumber(b.installmentCount)
            : null,
          paymentChoice: selectedTemplate ? b.paymentChoice : null,
          cardTerms: selectedTemplate ? b.cardTerms?.trim() || null : null,
        }
      : {};
    let total = optionalMoney(b.total);
    if (selectedTemplate) {
      total =
        quoteValues.paymentChoice === "installments"
          ? quoteValues.installmentTotal
          : quoteValues.cashTotal;
      if (total == null)
        throw Error("Informe o valor da condição de pagamento escolhida.");
    }
    const sheetValues =
      type === "contract"
        ? Object.fromEntries(
            CONTRACT_SHEET_FIELDS.map(([name]) => [
              name,
              String(b[name] ?? "").trim(),
            ]),
          )
        : {};
    // A lista em texto continua gravada para o orçamento e as telas; os itens
    // guardam o quadro de cada produto, que o contrato imprime sem adivinhar.
    const chosen = cleanItems(items.read());
    // Parte do documento original para não perder campos que não estão no formulário
    // (por exemplo, o vínculo do contrato com o orçamento de origem).
    return api("/records/documents", {
      ...d,
      ...b,
      ...quoteValues,
      ...sheetValues,
      id: d.id,
      type,
      client: { ...client },
      total: total ?? 0,
      extraHour: optionalMoney(b.extraHour) ?? 0,
      imageConsent: b.imageConsent === "on",
      clauses: b.clauses || d.clauses || state.settings.clauses,
      items: chosen,
      equipmentExtra: String(b.equipmentExtra || "").trim(),
      equipment: equipmentText(chosen, b.equipmentExtra),
      payments,
    });
  };
  const ctrl = openModal(
    `${isNew ? "Novo" : "Editar"} ${isQuote ? "orçamento" : "contrato"}`,
    html,
    onSubmit,
    {
      submitLabel: `Salvar ${isQuote ? "orçamento" : "contrato"}`,
      draft: draftKey(type, draftId ?? d.id),
      notice,
    },
  );
  const combo = bindClientCombo(ctrl, d.client);
  const form = ctrl.form,
    paymentList = $("#payments", form),
    input = (name) => $(`#f-${name}`, form);
  const setValue = (name, value) => {
    const el = input(name);
    if (!el) return;
    el.value = el.matches("[data-money]")
      ? formatMoneyInput(value)
      : (value ?? "");
  };
  const moneyValue = (name) => {
    const value = parseMoney(input(name)?.value);
    return value == null || Number.isNaN(value) ? null : value;
  };
  const sameCents = (a, b) => Math.round(a * 100) === Math.round(b * 100);

  const items = bindItems(ctrl, initialItems);

  // Vencimentos com soma em tempo real.
  const clearPaymentError = () => clearError($("[data-group-error]", form));
  const renumberPayments = () => {
    const rows = $$(".payment-row", paymentList);
    rows.forEach((row, i) => {
      $('[type="date"]', row).setAttribute(
        "aria-label",
        `Vencimento da parcela ${i + 1}`,
      );
      $("[data-money]", row).setAttribute(
        "aria-label",
        `Valor da parcela ${i + 1} em reais`,
      );
      $("[data-remove-payment]", row).setAttribute(
        "aria-label",
        `Remover parcela ${i + 1}`,
      );
    });
    $("#payment-head", form).hidden = !rows.length;
    $("#splitpayments", form).hidden = !rows.length;
  };
  const updatePaymentSum = () => {
    const rows = $$(".payment-row", paymentList),
      out = $("#payment-sum", form);
    out.className = "payment-sum";
    if (!rows.length) {
      out.textContent = "";
      clearPaymentError();
      return;
    }
    const total = moneyValue("total");
    const sum = rows.reduce(
      (s, row) => s + (parseMoney($("[data-money]", row).value) || 0),
      0,
    );
    if (total == null) {
      out.textContent = `Soma das parcelas: ${money(sum)}. Informe o valor total do documento.`;
      return;
    }
    const diff = Math.round((total - sum) * 100) / 100;
    if (sameCents(sum, total)) {
      out.textContent = `Soma das parcelas: ${money(sum)}. Confere com o total.`;
      out.classList.add("ok");
      clearPaymentError();
      return;
    }
    out.textContent =
      diff > 0
        ? `Soma das parcelas: ${money(sum)} de ${money(total)}. Faltam ${money(diff)}.`
        : `Soma das parcelas: ${money(sum)} de ${money(total)}. Passou ${money(-diff)} do total.`;
    out.classList.add("warn");
  };
  const addPayment = (payment = {}) => {
    const row = document.createElement("div");
    row.className = "payment-row";
    row.innerHTML = `<input type="date" value="${esc(payment.date)}" required><div class="input-affix"><span class="affix" aria-hidden="true">R$</span><input type="text" inputmode="decimal" autocomplete="off" data-money value="${esc(formatMoneyInput(payment.amount))}" placeholder="0,00" required></div><button type="button" class="icon-button" data-remove-payment>×</button>`;
    paymentList.append(row);
    renumberPayments();
    updatePaymentSum();
    return row;
  };
  $("#addpayment", form).onclick = () => {
    $('[type="date"]', addPayment()).focus();
    ctrl.changed();
  };
  paymentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-payment]");
    if (!button) return;
    clearPaymentError();
    for (const invalid of $$("[data-error-id]", button.closest(".payment-row")))
      clearError(invalid);
    button.closest(".payment-row").remove();
    renumberPayments();
    updatePaymentSum();
    ctrl.changed();
    ($("[data-remove-payment]", paymentList) || $("#addpayment", form)).focus();
  });
  paymentList.addEventListener("input", updatePaymentSum);
  input("total").addEventListener("input", updatePaymentSum);
  $("#splitpayments", form).onclick = () => {
    const rows = $$(".payment-row", paymentList),
      total = moneyValue("total");
    if (!rows.length) return;
    if (total == null) {
      showError({
        el: input("total"),
        message: "Informe o valor total antes de distribuir as parcelas.",
      });
      input("total").focus();
      return;
    }
    splitAmount(total, rows.length).forEach((value, i) => {
      const amount = $("[data-money]", rows[i]);
      amount.value = formatMoneyInput(value);
      if (amount.dataset.errorId && !amount.dataset.groupError)
        clearError(amount);
    });
    updatePaymentSum();
    ctrl.changed();
  };
  ctrl.extraValidation = () => {
    const amounts = $$(".payment-row [data-money]", paymentList);
    if (!amounts.length) return [];
    const values = amounts.map((amount) => parseMoney(amount.value));
    if (values.some((value) => value == null || Number.isNaN(value))) return [];
    const total = moneyValue("total");
    if (total == null) return [];
    const sum = values.reduce((s, value) => s + value, 0);
    if (sameCents(sum, total)) return [];
    return [
      {
        el: amounts[0],
        targets: amounts,
        after: $("#payment-sum", form),
        group: true,
        label: "Vencimentos do pagamento",
        message: `A soma das parcelas (${money(sum)}) precisa ser igual ao total do documento (${money(total)}). Ajuste os valores ou use “Distribuir o total igualmente”.`,
      },
    ];
  };
  input("packageId").onchange = (event) => {
    const pk = state.packages.find((x) => String(x.id) === event.target.value);
    if (!pk) return;
    setValue("packageName", pk.name);
    setValue("total", pk.price);
    // Pacote antigo sem itens: a lista em texto vai para os itens soltos.
    items.fill(pk.items || []);
    setValue(
      "equipmentExtra",
      pk.equipmentExtra ??
        ((pk.items || []).length ? "" : (pk.equipment ?? "")),
    );
    updatePaymentSum();
  };

  const fillOffers = (t) => {
    const offers = input("offerId");
    if (offers)
      offers.innerHTML = (t?.offers || [])
        .map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`)
        .join("");
  };
  let updatePrice = updatePaymentSum;
  if (isQuote) {
    const intValue = (name) =>
      input(name).value === "" ? null : Number(input(name).value);
    updatePrice = (updateCard = false) => {
      const active = Boolean(input("templateId").value);
      $("#quote-template-fields", form).hidden = !active;
      $("#quote-price-fields", form).hidden = !active;
      for (const id of ["quote-template-fields", "quote-price-fields"])
        $$(`#${id} input, #${id} select, #${id} textarea`, form).forEach(
          (el) => (el.disabled = !active),
        );
      input("packageId").disabled = active;
      input("total").readOnly = active;
      const hasInstallments = moneyValue("installmentTotal") !== null;
      $('[value="installments"]', input("paymentChoice")).disabled =
        !hasInstallments;
      if (!hasInstallments) input("paymentChoice").value = "cash";
      if (active) {
        const selectedPrice = moneyValue(
          input("paymentChoice").value === "installments"
            ? "installmentTotal"
            : "cashTotal",
        );
        setValue("total", selectedPrice ?? "");
        if (updateCard)
          setValue(
            "cardTerms",
            hasInstallments
              ? cardTerms(
                  moneyValue("installmentTotal"),
                  intValue("installmentCount") || 0,
                )
              : "",
          );
      }
      const boletoDate = dateBeforeEvent(input("date").value);
      $("#quote-payment-helper", form).textContent =
        `O total do documento acompanha a condição escolhida. ${boletoDate ? `Boleto: vencimento até ${date(boletoDate)}, 10 dias antes do evento.` : "Defina a data do evento para calcular o vencimento do boleto (10 dias antes)."}`;
      updatePaymentSum();
    };
    input("templateId").onchange = () => {
      const selected = templates.find(
        (t) => t.id === input("templateId").value,
      );
      fillOffers(selected);
      items.fill([]);
      if (selected) {
        for (const [name, value] of Object.entries(
          templateDefaults(selected, selected.offers[0]),
        ))
          setValue(name, value);
      }
      updatePrice();
    };
    input("offerId").onchange = () => {
      const selected = templates.find(
        (t) => t.id === input("templateId").value,
      );
      const offer = selected?.offers.find(
        (o) => o.id === input("offerId").value,
      );
      if (!offer) return;
      items.fill([]);
      for (const [name, value] of Object.entries({
        packageName: offer.name,
        equipmentExtra: offer.equipment,
        cashTotal: offer.cashPrice,
        installmentTotal: offer.installmentPrice,
        installmentCount: offer.installmentCount,
        cardTerms:
          offer.installmentPrice == null
            ? ""
            : cardTerms(offer.installmentPrice, offer.installmentCount),
        paymentNotes: offerPaymentNotes(offer),
        notes: [offer.description, selected.reservationNotes]
          .filter(Boolean)
          .join("\n\n"),
      }))
        setValue(name, value);
      updatePrice();
    };
    for (const name of ["cashTotal", "installmentTotal", "installmentCount"])
      input(name).addEventListener("input", () => updatePrice(true));
    input("paymentChoice").onchange = () => updatePrice();
    input("date").addEventListener("change", () => updatePrice());
  }
  // Restaura um rascunho guardado neste navegador.
  const fillForm = (values) => {
    if (isQuote && "templateId" in values) {
      input("templateId").value = values.templateId;
      fillOffers(templates.find((t) => t.id === values.templateId));
    }
    for (const [name, value] of Object.entries(values)) {
      if (name === "templateId" || name === "__payments") continue;
      const el = form.elements.namedItem(name);
      if (!el || el instanceof RadioNodeList) continue;
      if (el.type === "checkbox") el.checked = Boolean(value);
      else el.value = value;
    }
    paymentList.innerHTML = "";
    for (const [dateValue, amount] of values.__payments || [])
      addPayment({ date: dateValue, amount });
    if (values.__items) items.fill(values.__items);
    const sheet = $("#more-fields", form);
    if (
      sheet &&
      CONTRACT_SHEET_FIELDS.some(([name]) => input(name)?.value.trim())
    )
      sheet.open = true;
    combo.syncLabel();
    updatePrice();
  };

  for (const payment of data.payments || []) addPayment(payment);
  updatePrice();
  ctrl.markPristine();
  ctrl.offerDraft(fillForm);
  return ctrl;
}
// ---------- Campo Cliente com busca e cadastro na hora (padrão combobox do WAI-ARIA) ----------
function clientCombo(selectedId, snapshot) {
  const selected = findClient(selectedId);
  const label = selected
    ? selected.name
    : snapshot && selectedId !== ""
      ? `${snapshot.name} (dados do documento)`
      : "";
  return `<div class="field combo"><label for="f-client-search">Cliente${REQUIRED}</label><div class="combo-box"><input id="f-client-search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="client-options" aria-describedby="client-hint" autocomplete="off" required data-combo-input="clientId" value="${esc(label)}" placeholder="Digite o nome do cliente"><input type="hidden" id="f-clientId" name="clientId" value="${esc(selectedId ?? "")}"><ul id="client-options" role="listbox" aria-label="Clientes" hidden></ul></div><p class="hint" id="client-hint">Busque pelo nome ou cadastre um cliente novo sem sair deste formulário.</p></div>`;
}
function bindClientCombo(ctrl, snapshot) {
  const form = ctrl.form,
    box = $("#f-client-search", form),
    hidden = form.elements.namedItem("clientId"),
    list = $("#client-options", form);
  let options = [],
    active = -1;
  const labelFor = (id) =>
    findClient(id)?.name ??
    (snapshot && id !== "" && String(snapshot.id ?? id) === String(id)
      ? `${snapshot.name} (dados do documento)`
      : "");
  const close = () => {
    list.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const highlight = (index) => {
    active = index;
    [...list.children].forEach((li, i) =>
      li.classList.toggle("active", i === index),
    );
    const li = list.children[index];
    if (li) {
      box.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    } else box.removeAttribute("aria-activedescendant");
  };
  const open = () => {
    const query = normalizeText(box.value),
      typed = box.value.trim();
    const matches = state.clients
      .filter(
        (c) =>
          !query ||
          normalizeText(`${c.name} ${c.email} ${c.phone}`).includes(query),
      )
      .slice(0, 8);
    options = [
      ...matches.map((c) => ({
        id: c.id,
        label: c.name,
        sub: [c.phone, c.email].filter(Boolean).join(" · "),
      })),
      {
        create: true,
        label: typed
          ? `Cadastrar “${typed}” como novo cliente`
          : "Cadastrar novo cliente",
      },
    ];
    list.innerHTML = options
      .map(
        (o, i) =>
          `<li id="client-opt-${i}" role="option" aria-selected="${!o.create && String(o.id) === hidden.value}" class="${o.create ? "create" : ""}" data-index="${i}">${o.create ? '<span aria-hidden="true">＋ </span>' : ""}${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</li>`,
      )
      .join("");
    list.hidden = false;
    box.setAttribute("aria-expanded", "true");
    highlight(query && matches.length ? 0 : -1);
  };
  const select = (client) => {
    hidden.value = client.id;
    box.value = client.name;
    revalidate(box);
    ctrl.changed();
  };
  // Cadastro em um segundo diálogo, por cima do orçamento, que continua aberto.
  const create = (name) =>
    editClient(
      { name },
      (client) => {
        if (client?.id) select({ id: client.id, name: client.name });
        box.focus();
      },
      { dialog: subdialog },
    );
  const choose = (option) => {
    close();
    if (option.create) create(box.value.trim());
    else select(option);
  };
  box.addEventListener("input", () => {
    if (box.value !== labelFor(hidden.value)) hidden.value = "";
    open();
    ctrl.changed();
  });
  box.addEventListener("click", () => list.hidden && open());
  box.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) open();
      const n = options.length;
      highlight(
        event.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n,
      );
    } else if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape" && !list.hidden) {
      // Fecha só a lista; o Esc não chega ao diálogo.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close();
  });
  box.addEventListener("blur", () =>
    setTimeout(() => {
      if (document.activeElement === box) return;
      close();
      // Nome digitado igual ao de um cliente cadastrado: seleciona sem exigir clique.
      const exact =
        !hidden.value &&
        state.clients.find(
          (c) => normalizeText(c.name) === normalizeText(box.value),
        );
      if (exact) select(exact);
    }, 150),
  );
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const li = event.target.closest("[data-index]");
    if (li) choose(options[Number(li.dataset.index)]);
  });
  return { syncLabel: () => (box.value = labelFor(hidden.value)) };
}
async function convertQuote(id, button) {
  const quote = findDoc(id);
  if (!quote) return;
  const existing = contractFor(quote);
  if (existing) {
    pushRoute(docHref(existing));
    render();
    editDoc("contract", existing, {
      notice: `Este orçamento já tem o contrato <strong>${esc(existing.number)}</strong>. Revise os dados e salve.`,
    });
    return;
  }
  if (button) button.disabled = true;
  try {
    const contract = await api(`/documents/${quote.id}/convert`, {});
    // Abre a tela do contrato novo e, por cima, o formulário para revisão.
    pushRoute(buildHash({ page: "contracts", id: contract.id }));
    await load();
    const fresh = findDoc(contract.id) || contract;
    editDoc("contract", fresh, {
      notice: `Contrato <strong>${esc(fresh.number)}</strong> gerado a partir do orçamento ${esc(quote.number)}. Revise cláusulas, horários e pagamento e salve.`,
    });
  } catch (error) {
    toast(error.message, "error");
    if (button) button.disabled = false;
  }
}

// ---------- Tela do documento: resumo, histórico e ações ----------
const dl = (rows) =>
  `<dl class="facts">${rows
    .filter(([, value]) => value !== "" && value != null)
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`)
    .join("")}</dl>`;
const panel = (title, body, cls = "") =>
  `<section class="panel detail-panel${cls ? ` ${cls}` : ""}"><h2>${title}</h2>${body}</section>`;
function docDetail(d) {
  const isQuote = d.type === "quote",
    status = displayStatus(d),
    contract = isQuote ? contractFor(d) : null,
    source = !isQuote && d.sourceId ? findDoc(d.sourceId) : null,
    client = findClient(d.clientId ?? d.client?.id),
    snap = d.client || {};
  const actions = d.archived
    ? `<button type="button" class="primary" data-restore="${d.id}">Restaurar</button><button type="button" class="danger-outline" data-delete="${d.id}">Excluir definitivamente</button>`
    : `${d.status !== "cancelled" ? `<button type="button" class="primary" data-send="${d.id}">${icon("chat")} Enviar pelo WhatsApp</button>` : ""}<button type="button" data-edit-doc="${d.id}">Editar</button><button type="button" data-preview-pdf="${d.id}">Visualizar PDF<span class="sr-only"> (abre em nova aba)</span> <span aria-hidden="true">↗</span></button>${isQuote ? (contract ? linkButton(docHref(contract), "Ver contrato") : `<button type="button" data-convert="${d.id}">Gerar contrato</button>`) : ""}<button type="button" class="icon-button dots" data-menu="${d.id}" popovertarget="row-menu" aria-label="Mais ações">${icon("more")}</button>`;
  const banner = d.archived
    ? `<div class="notice archived-banner" role="note">Este ${isQuote ? "orçamento" : "contrato"} está arquivado${d.archivedAt ? ` desde ${dateTime(d.archivedAt)}` : ""}. Ele não aparece nas listas nem no painel. Restaure para editar ou enviar.</div>`
    : "";
  const payments = (d.payments || []).length
    ? `<ul class="plain-list">${d.payments.map((p, i) => `<li><span>${i + 1}ª parcela · ${date(p.date)}</span><strong>${money(p.amount)}</strong></li>`).join("")}</ul>`
    : "";
  const choice =
    d.templateId && d.paymentChoice
      ? d.paymentChoice === "installments"
        ? "Parcelado"
        : "À vista"
      : "";
  const values = panel(
    "Valores e pagamento",
    `<p class="detail-total">${money(d.total)}</p>${dl([
      ["Condição escolhida", choice],
      [
        "Cartão",
        d.paymentChoice === "installments" ? esc(d.cardTerms || "") : "",
      ],
      ["Hora adicional", Number(d.extraHour) > 0 ? money(d.extraHour) : ""],
      ["Validade", isQuote && d.validUntil ? date(d.validUntil) : ""],
      ["Forma de pagamento", esc(d.paymentNotes || "")],
    ])}${payments}`,
  );
  const event = panel(
    "Evento",
    dl([
      ["Data", date(d.date)],
      ["Local", esc(d.venue || "A definir")],
      ["Convidados", esc(d.guests || "")],
      ["Montagem", esc(d.setup || "")],
      ["Cerimônia", esc(d.ceremony || "")],
      ["Início", esc(d.start || "")],
      ["Término", esc(d.end || "")],
      ...(isQuote
        ? []
        : CONTRACT_SHEET_FIELDS.map(([name, label]) => [
            label,
            esc(d[name] || ""),
          ])),
    ]),
  );
  const who = panel(
    "Cliente",
    dl([
      [
        "Nome",
        client
          ? `<a href="${clientHref(client)}">${esc(client.name)}</a>`
          : esc(snap.name),
      ],
      ["WhatsApp", esc(snap.phone || "")],
      [
        "E-mail",
        snap.email
          ? `<a href="mailto:${esc(snap.email)}">${esc(snap.email)}</a>`
          : "",
      ],
      ["CPF / CNPJ", esc(snap.document || "")],
      ["Endereço", esc(snap.address || "")],
    ]) +
      (client
        ? ""
        : '<p class="hint">Cadastro do cliente não encontrado; dados registrados na emissão.</p>'),
  );
  // Com itens do catálogo, mostra agrupado pelo quadro do contrato, para conferir
  // antes de emitir se cada coisa vai sair na coluna certa.
  const grouped = (d.items || []).length
    ? EQUIPMENT_CATEGORIES.filter((c) =>
        d.items.some((i) => i.category === c.id),
      )
        .map(
          (c) =>
            `<div class="service-group"><h3>${esc(c.label)}</h3><ul class="plain-list bullets">${d.items
              .filter((i) => i.category === c.id)
              .map((i) => `<li>${esc(qtyLabel(i.qty))} ${esc(i.name)}</li>`)
              .join("")}</ul></div>`,
        )
        .join("") +
      (d.equipmentExtra
        ? `<div class="service-group"><h3>Outros itens</h3><ul class="plain-list bullets">${String(
            d.equipmentExtra,
          )
            .split("\n")
            .filter(Boolean)
            .map((x) => `<li>${esc(x)}</li>`)
            .join("")}</ul></div>`
        : "")
    : `<ul class="plain-list bullets">${String(d.equipment || "")
        .split("\n")
        .filter(Boolean)
        .map((x) => `<li>${esc(x)}</li>`)
        .join("")}</ul>`;
  const services = panel(
    "Serviços",
    `<p class="detail-strong">${esc(d.packageName || "")}</p>${grouped}${d.notes ? `<p class="detail-notes">${esc(d.notes)}</p>` : ""}`,
  );
  const link = isQuote
    ? contract
      ? `<p>Contrato <a href="${docHref(contract)}"><span class="doc-number">${esc(contract.number)}</span></a> gerado a partir deste orçamento.</p>`
      : "<p>Nenhum contrato gerado ainda.</p>"
    : source
      ? `<p>Gerado do orçamento <a href="${docHref(source)}"><span class="doc-number">${esc(source.number)}</span></a>.</p>`
      : "<p>Contrato criado sem orçamento de origem.</p>";
  const timeline = `<ol class="timeline">${historyEvents(d)
    .map(
      (e) =>
        `<li><time datetime="${esc(e.at)}">${dateTime(e.at)}</time><span>${esc(e.text)}</span></li>`,
    )
    .join("")}</ol>`;
  return {
    title: `${docKind(d)} ${d.number}`,
    crumbs: [
      HOME,
      sectionCrumb(listPageFor(d.type)),
      { label: d.number || docKind(d) },
    ],
    html: `${banner}<div class="page-head detail-head"><div><p class="doc-kicker">${docKind(d)} <span class="doc-number">${esc(d.number || "")}</span></p><h1 tabindex="-1">${esc(d.event || docKind(d))}</h1><p>${esc(snap.name)} · ${date(d.date)}${d.venue ? ` · ${esc(d.venue)}` : ""}</p><div class="detail-status">${badge(d.archived ? "archived" : status)}${d.archived ? "" : validityNote(d, status)}</div></div><div class="actions">${actions}</div></div><div class="detail-grid">${values}${event}${who}${services}${panel(isQuote ? "Contrato" : "Origem", link)}${panel("Histórico", timeline)}</div>`,
  };
}

// ---------- Tela do cliente: contato, resumo e documentos ----------
function clientDetail(c) {
  const all = docsOfClient(c),
    active = all.filter((d) => !d.archived),
    contracts = active.filter((d) => d.type === "contract"),
    closed = contracts.filter((d) => ["approved", "signed"].includes(d.status)),
    next = contracts
      .filter((d) => d.date >= today() && d.status !== "cancelled")
      .sort((a, b) => a.date.localeCompare(b.date))[0],
    wa = whatsappNumber(c.phone);
  const contact = panel(
    "Contato",
    dl([
      [
        "WhatsApp",
        c.phone
          ? `${esc(c.phone)}${wa ? ` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">Abrir conversa<span class="sr-only"> (abre em nova aba)</span></a>` : ""}`
          : "",
      ],
      [
        "E-mail",
        c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "",
      ],
      ["CPF / CNPJ", esc(c.document || "")],
      ["Endereço", esc(c.address || "")],
    ]) || '<p class="hint">Nenhum contato cadastrado.</p>',
  );
  const summary = panel(
    "Resumo",
    dl([
      ["Orçamentos", String(active.length - contracts.length)],
      ["Contratos", String(contracts.length)],
      [
        "Valor contratado",
        money(closed.reduce((s, d) => s + Number(d.total || 0), 0)),
      ],
      [
        "Próximo evento",
        next
          ? `<a href="${docHref(next)}">${date(next.date)} · ${esc(next.event)}</a>`
          : "Nenhum agendado",
      ],
    ]),
  );
  const list = docEntries(entriesOf(sortDocs(all, "recent")), {
    compact: true,
    emptyHtml: empty(
      "Nenhum documento ainda",
      "Crie o primeiro orçamento para este cliente.",
      "",
      "",
    ),
  });
  return {
    title: c.name,
    crumbs: [HOME, sectionCrumb("clients"), { label: c.name }],
    html: `<div class="page-head detail-head"><div><p class="doc-kicker">Cliente</p><h1 tabindex="-1">${esc(c.name)}</h1><p>${esc([c.phone, c.email].filter(Boolean).join(" · ") || "Sem contato cadastrado")}</p></div><div class="actions"><button type="button" class="primary" data-new-for="${c.id}"><span aria-hidden="true">＋</span> Novo orçamento</button><button type="button" data-edit-client="${c.id}">Editar cliente</button><button type="button" class="danger-outline" data-delete-client="${c.id}">Excluir cliente</button></div></div><div class="detail-grid two">${contact}${summary}</div><section class="panel panel-gap"><div class="panel-title"><h2>Documentos</h2></div>${list}</section>`,
  };
}

// ---------- Novo orçamento: escolher modelo ou começar em branco ----------
function openPicker(extra = {}) {
  const templates = state.quoteTemplates || QUOTE_TEMPLATES;
  const tags = (t) =>
    t.offers.length > 1
      ? `${t.offers.length} opções de serviço`
      : "Pacote completo";
  picker.innerHTML = `<div class="modal-head"><h2 id="picker-title">Novo orçamento</h2><button type="button" class="icon-button" data-picker-close aria-label="Fechar">×</button></div><div class="modal-body"><p class="picker-intro">Escolha um modelo pronto ou comece em branco. Tudo continua editável.</p><div class="picker-grid">${templates
    .map(
      (t) =>
        `<button type="button" class="picker-option" data-pick="${esc(t.id)}"><img src="/quote-assets/estrutura.png" alt="" loading="lazy"><span class="picker-name">${esc(t.name)}</span><span class="picker-desc">${esc(t.description)}</span><span class="picker-tag">${tags(t)}</span></button>`,
    )
    .join(
      "",
    )}<button type="button" class="picker-option blank" data-pick=""><span class="picker-plus" aria-hidden="true">＋</span><span class="picker-name">Começar em branco</span><span class="picker-desc">Sem modelo: serviços e valores do seu jeito.</span></button></div></div>`;
  picker.onclick = (event) => {
    const button = event.target.closest("[data-pick], [data-picker-close]");
    if (!button) return;
    picker.close();
    if ("pick" in button.dataset)
      editDoc("quote", {
        ...extra,
        ...(button.dataset.pick ? { templateId: button.dataset.pick } : {}),
      });
  };
  picker.showModal();
}
// ---------- Confirmação de ações sem volta ----------
function confirmAction({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    confirmBox.innerHTML = `<div class="modal-head"><h2 id="confirm-title">${esc(title)}</h2></div><div class="modal-body"><p id="confirm-text" class="confirm-text">${message}</p></div><div class="modal-foot"><button type="button" data-answer="no">Cancelar</button><button type="button" class="danger" data-answer="yes">${esc(confirmLabel)}</button></div>`;
    let answered = false;
    const done = (value) => {
      if (answered) return;
      answered = true;
      if (confirmBox.open) confirmBox.close();
      resolve(value);
    };
    confirmBox.onclick = (event) => {
      const answer = event.target.closest("[data-answer]")?.dataset.answer;
      if (answer) done(answer === "yes");
    };
    confirmBox.onclose = () => done(false);
    confirmBox.showModal();
    $('[data-answer="no"]', confirmBox).focus(); // a opção segura recebe o foco
  });
}
// ---------- Arquivar, restaurar, excluir e duplicar ----------
async function archiveDoc(id) {
  const d = findDoc(id);
  if (!d) return;
  try {
    await api(`/documents/${id}/archive`, {});
  } catch (error) {
    return toast(error.message, "error");
  }
  pendingFocus = route.id === id ? "heading" : "#search";
  await load();
  toast(
    `${docKind(d)} ${d.number} arquivado. Ele sai das listas e do painel.`,
    "success",
    {
      action: { label: "Desfazer", onClick: () => restoreDoc(id) },
    },
  );
}
async function restoreDoc(id) {
  const d = findDoc(id);
  try {
    await api(`/documents/${id}/restore`, {});
  } catch (error) {
    return toast(error.message, "error");
  }
  if (route.id !== id) pendingFocus = "#search";
  await load();
  toast(`${d ? `${docKind(d)} ${d.number}` : "Documento"} restaurado.`);
}
async function deleteDoc(id) {
  const d = findDoc(id);
  if (!d) return;
  const linked =
    d.type === "quote" && contractFor(d)
      ? ` O contrato ${esc(contractFor(d).number)} continua salvo.`
      : "";
  const ok = await confirmAction({
    title: "Excluir definitivamente?",
    message: `${docKind(d)} <strong>${esc(d.number)}</strong> de ${esc(d.client?.name)} será apagado. Esta ação não pode ser desfeita.${linked}`,
    confirmLabel: "Excluir definitivamente",
  });
  if (!ok) return;
  try {
    await api(`/documents/${id}`, null, { method: "DELETE" });
  } catch (error) {
    return toast(error.message, "error");
  }
  if (route.id === id) {
    history.replaceState(
      null,
      "",
      buildHash({ page: listPageFor(d.type), filter: "archived" }),
    );
    route = parseRoute(location.hash);
  }
  pendingFocus = "heading";
  await load();
  toast(`${docKind(d)} ${d.number} excluído.`);
}
// Cópia como rascunho novo: mantém serviços, valores e condições; cliente, evento e data ficam em branco.
function duplicateDoc(id) {
  const d = findDoc(id);
  if (!d) return;
  const copy = {
    ...d,
    status: "draft",
    copiedFrom: d.number,
    imageConsent: false,
  };
  for (const key of [
    "id",
    "number",
    "company",
    "createdAt",
    "updatedAt",
    "history",
    "sentAt",
    "archived",
    "archivedAt",
    "sourceId",
    "quoteTemplate",
    "client",
    "clientId",
    "date",
    "event",
    "guests",
    "payments",
  ])
    delete copy[key];
  // A ficha (indicação, recepção, equipe) é do evento copiado: começa em branco.
  for (const [key] of CONTRACT_SHEET_FIELDS) delete copy[key];
  if (d.type === "quote") copy.validUntil = addDays(today(), validityDays());
  editDoc(d.type, copy, {
    notice: `Cópia de <strong>${esc(d.number)}</strong>. Escolha o cliente e informe o evento e a data.`,
    draftId: `copia-${d.id}`,
  });
}

async function deleteClient(id) {
  const c = findClient(id);
  if (!c) return;
  const n = docsOfClient(c).length;
  const ok = await confirmAction({
    title: "Excluir cliente?",
    message: `O cadastro de <strong>${esc(c.name)}</strong> será apagado. ${n ? `${n === 1 ? "O documento dele continua salvo" : `Os ${n} documentos dele continuam salvos`} com os dados registrados na emissão.` : "Não há documentos deste cliente."} Esta ação não pode ser desfeita.`,
    confirmLabel: "Excluir cliente",
  });
  if (!ok) return;
  try {
    await api(`/records/clients/${id}`, null, { method: "DELETE" });
  } catch (error) {
    return toast(error.message, "error");
  }
  if (route.page === "clients" && route.id === id) {
    history.replaceState(null, "", buildHash({ page: "clients" }));
    route = parseRoute(location.hash);
  }
  pendingFocus = "heading";
  await load();
  toast(`Cliente ${c.name} excluído.`);
}
async function deletePackage(id) {
  const p = state.packages.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmAction({
    title: "Excluir pacote?",
    message: `O pacote <strong>${esc(p.name)}</strong> sai do catálogo. Orçamentos e contratos já emitidos não mudam. Esta ação não pode ser desfeita.`,
    confirmLabel: "Excluir pacote",
  });
  if (!ok) return;
  try {
    await api(`/records/packages/${id}`, null, { method: "DELETE" });
  } catch (error) {
    return toast(error.message, "error");
  }
  pendingFocus = "heading";
  await load();
  toast(`Pacote ${p.name} excluído.`);
}

// ---------- Enviar pelo WhatsApp ----------
// Abre a conversa com mensagem pronta (o PDF vai como anexo) e registra o envio no histórico.
function sendDialog(id) {
  const d = findDoc(id);
  if (!d) return;
  const client = findClient(d.clientId ?? d.client?.id) || d.client || {},
    isDraft = d.status === "draft",
    noun = d.type === "quote" ? "orçamento" : "contrato";
  const html = `${field(
    "WhatsApp do cliente",
    "waPhone",
    maskPhone(client.phone || ""),
    "tel",
    false,
    false,
    {
      attrs: 'data-mask="phone" autocomplete="off"',
      hint: "Com DDD. Sem número, o WhatsApp pede para escolher o contato.",
    },
  )}${area("Mensagem", "waMessage", whatsappMessage(d, { company: d.company || state.settings }), true, { attrs: 'rows="9"' })}<div class="field full send-pdf"><span class="label">PDF do ${noun}</span><p class="hint">O WhatsApp abre em outra aba com a mensagem. Baixe o PDF e anexe na conversa.</p><div class="payment-actions"><a class="btn" href="/api/documents/${d.id}/pdf" download>Baixar PDF</a><button type="button" id="share-pdf" hidden>Compartilhar PDF</button></div></div><div class="field full"><label class="check"><input type="checkbox" name="markSent" checked> ${isDraft ? "Marcar como enviado (sai de Rascunho)" : "Registrar o envio no histórico"}</label></div>`;
  const ctrl = openModal(
    `Enviar ${noun} pelo WhatsApp`,
    html,
    (b) => {
      // A aba precisa abrir ainda no clique, antes de qualquer espera, para não ser bloqueada.
      const tab = window.open(
        whatsappLink(whatsappNumber(b.waPhone), b.waMessage),
        "_blank",
      );
      if (!tab)
        throw Error(
          "O navegador bloqueou a nova aba. Permita pop-ups para este endereço e tente de novo.",
        );
      tab.opener = null;
      return b.markSent === "on"
        ? api(`/documents/${d.id}/sent`, { channel: "whatsapp" })
        : null;
    },
    {
      submitLabel: "Abrir WhatsApp",
      successMessage: "",
      legend: false,
      onSaved: (saved) =>
        toast(
          saved
            ? "WhatsApp aberto em outra aba. Envio registrado."
            : "WhatsApp aberto em outra aba.",
        ),
    },
  );
  const form = ctrl.form,
    phone = $("#f-waPhone", form);
  ctrl.extraValidation = () =>
    phone.value.trim() && !whatsappNumber(phone.value)
      ? [
          {
            el: phone,
            message: "Informe o número com DDD, por exemplo (47) 99999-0000.",
          },
        ]
      : [];
  // Celular e computadores com compartilhamento nativo: envia o arquivo direto para o WhatsApp.
  const share = $("#share-pdf", form);
  if (
    !navigator.canShare?.({
      files: [new File([""], "teste.pdf", { type: "application/pdf" })],
    })
  )
    return;
  share.hidden = false;
  const file = fetch(`/api/documents/${d.id}/pdf`)
    .then((r) => (r.ok ? r.blob() : Promise.reject(Error())))
    .then(
      (blob) =>
        new File([blob], `${d.number}.pdf`, { type: "application/pdf" }),
    )
    .catch(() => null);
  share.onclick = async () => {
    const pdf = await file;
    try {
      if (!pdf) throw Error("Não foi possível preparar o PDF.");
      await navigator.share({
        files: [pdf],
        text: $("#f-waMessage", form).value,
      });
    } catch (error) {
      if (error.name !== "AbortError")
        showSummary(
          ctrl.alerts,
          [
            {
              message: error.message || "O compartilhamento não foi concluído.",
            },
          ],
          "Não foi possível compartilhar",
        );
      return;
    }
    const saved = $('[name="markSent"]', form).checked
      ? await api(`/documents/${d.id}/sent`, { channel: "share" }).catch(
          () => null,
        )
      : null;
    ctrl.close();
    await load();
    toast(
      saved ? "PDF compartilhado. Envio registrado." : "PDF compartilhado.",
    );
  };
}

// ---------- Menu "⋯" das linhas (um único popover, preenchido para a linha clicada) ----------
function menuItems(d) {
  const button = (attr, label, cls = "") =>
    `<button type="button"${cls ? ` class="${cls}"` : ""} ${attr}>${label}</button>`;
  if (d.archived)
    return [
      button(`data-restore="${d.id}"`, "Restaurar"),
      button(`data-pdf="${d.id}"`, "Baixar PDF"),
      "<hr>",
      button(`data-delete="${d.id}"`, "Excluir definitivamente", "danger-text"),
    ].join("");
  const contract = d.type === "quote" ? contractFor(d) : null,
    source = d.type === "contract" && d.sourceId ? findDoc(d.sourceId) : null;
  return [
    `<a href="${docHref(d)}">Abrir ${d.type === "quote" ? "orçamento" : "contrato"}</a>`,
    button(
      `data-preview-pdf="${d.id}"`,
      'Visualizar PDF<span class="sr-only"> (abre em nova aba)</span> <span aria-hidden="true">↗</span>',
    ),
    button(`data-pdf="${d.id}"`, "Baixar PDF"),
    d.status !== "cancelled"
      ? button(`data-send="${d.id}"`, "Enviar pelo WhatsApp")
      : "",
    button(`data-edit-doc="${d.id}"`, "Editar"),
    button(`data-duplicate="${d.id}"`, "Duplicar"),
    d.type === "quote"
      ? contract
        ? `<a href="${docHref(contract)}">Ver contrato</a>`
        : button(`data-convert="${d.id}"`, "Gerar contrato")
      : source
        ? `<a href="${docHref(source)}">Ver orçamento de origem</a>`
        : "",
    "<hr>",
    button(`data-archive="${d.id}"`, "Arquivar"),
  ].join("");
}
function prepareRowMenu(button, event) {
  const d = findDoc(button.dataset.menu);
  if (!d) return event.preventDefault();
  const open = rowMenu.matches(":popover-open");
  if (open && menuTrigger === button) return; // o próprio botão fecha o menu
  if (open) {
    event.preventDefault();
    rowMenu.hidePopover();
  }
  rowMenu.innerHTML = `<p class="menu-title" id="row-menu-title">${esc(d.client?.name)} · <span class="doc-number">${esc(d.number || "")}</span></p>${menuItems(d)}`;
  rowMenu.setAttribute("aria-labelledby", "row-menu-title");
  menuTrigger = button;
  rowMenu.dataset.keyboard = event.detail === 0 ? "1" : "";
  const r = button.getBoundingClientRect();
  rowMenu.style.top = `${r.bottom + 6}px`;
  rowMenu.style.left = `${Math.max(8, r.right - 240)}px`;
  if (open) rowMenu.showPopover({ source: button });
}
function positionMenu() {
  if (!menuTrigger?.isConnected) return;
  const r = menuTrigger.getBoundingClientRect(),
    w = rowMenu.offsetWidth,
    h = rowMenu.offsetHeight;
  const top =
    r.bottom + 6 + h > innerHeight - 8
      ? Math.max(8, r.top - h - 6)
      : r.bottom + 6;
  rowMenu.style.top = `${top}px`;
  rowMenu.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`;
}
let menuHadFocus = false;
rowMenu.addEventListener("beforetoggle", (event) => {
  if (event.newState === "closed")
    menuHadFocus = rowMenu.contains(document.activeElement);
});
rowMenu.addEventListener("toggle", (event) => {
  if (event.newState === "open") {
    positionMenu();
    if (rowMenu.dataset.keyboard) $("a, button", rowMenu)?.focus();
  } else if (
    menuHadFocus &&
    menuTrigger?.isConnected &&
    !document.querySelector("dialog[open]")
  )
    menuTrigger.focus();
});
// Setas, Home e End percorrem as opções; Tab fecha e volta para o botão "⋯".
rowMenu.addEventListener("keydown", (event) => {
  const items = $$("a, button", rowMenu),
    i = items.indexOf(document.activeElement),
    n = items.length;
  const move = {
    ArrowDown: (i + 1) % n,
    ArrowUp: (i - 1 + n) % n,
    Home: 0,
    End: n - 1,
  }[event.key];
  if (move !== undefined) {
    event.preventDefault();
    items[move]?.focus();
  } else if (event.key === "Tab") {
    event.preventDefault();
    rowMenu.hidePopover();
  }
});
addEventListener(
  "resize",
  () => rowMenu.matches(":popover-open") && rowMenu.hidePopover(),
);

// ---------- Navegação por endereço (hash) ----------
const routeKey = (r) => `${r.page}/${r.id ?? ""}`;
// Troca a tela atual por outra, criando um item no histórico (o botão Voltar funciona).
function pushRoute(hash) {
  scrollMemory.set(routeKey(route), scrollY);
  history.pushState(null, "", hash);
  route = parseRoute(hash);
  pendingFocus = "heading";
  window.scrollTo(0, 0);
}
// Desenha a tela do endereço atual. Voltando de um documento para a lista,
// a lista volta na mesma posição de rolagem.
function onRoute() {
  const previous = route;
  scrollMemory.set(routeKey(previous), scrollY);
  route = parseRoute(location.hash);
  pendingFocus = "heading";
  render();
  const back =
    previous.id != null && route.id == null && previous.page === route.page;
  window.scrollTo(0, back ? scrollMemory.get(routeKey(route)) || 0 : 0);
}
// Links internos passam por aqui para confirmar a saída de formulários alterados.
function navigate(hash) {
  if (pageGuard?.() && !confirm(LEAVE_MESSAGE)) return false;
  pageGuard = null;
  if (hash === location.hash || (hash === "#/" && !location.hash)) onRoute();
  else location.hash = hash;
  return true;
}
window.addEventListener("hashchange", () => {
  // Na tela de login o endereço fica guardado para abrir a tela certa depois de entrar.
  if (!user || !state || location.hash === renderedHash) return;
  // Voltar/Avançar do navegador com alterações não salvas: se cancelar, permanece na tela.
  if (pageGuard?.() && !confirm(LEAVE_MESSAGE)) {
    history.pushState(null, "", renderedHash || "#/");
    return;
  }
  pageGuard = null;
  onRoute();
});
history.scrollRestoration = "manual";
// ---------- Eventos ----------
function onClick(event) {
  if (event.defaultPrevented || event.target.closest("dialog")) return;
  const target = event.target.closest("button, a");
  if (!target) {
    // Clique na linha ou no cartão, fora dos botões, abre a tela do documento ou do cliente.
    const row = event.target.closest("[data-href]");
    if (row && !getSelection()?.toString()) navigate(row.dataset.href);
    return;
  }
  const ds = target.dataset,
    popover = target.closest("[popover]");
  if (target.tagName === "A") {
    if (ds.action === "skip") {
      event.preventDefault();
      $("#conteudo")?.focus();
      return;
    }
    const href = target.getAttribute("href") || "";
    // Ctrl/Cmd + clique e botão do meio continuam abrindo em nova aba.
    if (
      !href.startsWith("#/") ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    if (popover?.matches(":popover-open")) popover.hidePopover();
    navigate(href);
    return;
  }
  if (ds.menu) return prepareRowMenu(target, event);
  if (
    popover?.matches(":popover-open") &&
    !target.hasAttribute("popovertarget")
  )
    popover.hidePopover();
  const id = Number;
  if (ds.action === "logout") return logout();
  if (ds.action === "clear-filters") return clearFilters();
  if (ds.filter) return setFilter(ds.filter);
  if (ds.new) {
    if (ds.new === "client") return editClient();
    if (ds.new === "product") return editProduct();
    if (ds.new === "package") return editPackage();
    return ds.new === "quote" ? openPicker() : editDoc(ds.new);
  }
  if (ds.newFor) return openPicker({ clientId: ds.newFor });
  if (ds.quoteTemplate)
    return editDoc("quote", { templateId: ds.quoteTemplate });
  if (ds.editClient)
    return findClient(ds.editClient) && editClient(findClient(ds.editClient));
  if (ds.deleteClient) return deleteClient(id(ds.deleteClient));
  if (ds.editProduct)
    return editProduct(state.products.find((p) => p.id === id(ds.editProduct)));
  if (ds.deleteProduct) return deleteProduct(id(ds.deleteProduct));
  if (ds.editPackage)
    return editPackage(state.packages.find((p) => p.id === id(ds.editPackage)));
  if (ds.deletePackage) return deletePackage(id(ds.deletePackage));
  if (ds.editDoc)
    return (
      findDoc(ds.editDoc) &&
      editDoc(findDoc(ds.editDoc).type, findDoc(ds.editDoc))
    );
  if (ds.previewPdf)
    return void window.open(
      `/api/documents/${ds.previewPdf}/pdf?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  if (ds.pdf) return downloadPdf(ds.pdf);
  if (ds.convert) return convertQuote(id(ds.convert), target);
  if (ds.send) return sendDialog(id(ds.send));
  if (ds.duplicate) return duplicateDoc(id(ds.duplicate));
  if (ds.archive) return archiveDoc(id(ds.archive));
  if (ds.restore) return restoreDoc(id(ds.restore));
  if (ds.delete) return deleteDoc(id(ds.delete));
}
document.addEventListener("click", onClick);
root.addEventListener("input", (event) => {
  if (event.target.id !== "search") return;
  route.search = event.target.value;
  refreshList();
});
root.addEventListener("change", (event) => {
  if (event.target.id !== "sort") return;
  route.sort = event.target.value;
  refreshList();
});
function setFilter(tab) {
  route.filter = tab;
  refreshList();
  $(`.status-tab[data-filter="${tab}"]`)?.focus();
}
function clearFilters() {
  route.search = "";
  route.filter = "all";
  if ($("#search")) $("#search").value = "";
  refreshList();
  $("#search")?.focus();
}
function downloadPdf(id) {
  const link = document.createElement("a");
  link.href = `/api/documents/${id}/pdf`;
  link.download = "";
  link.click();
}
// Máscaras: filtram o que é digitado e formatam ao sair do campo.
document.addEventListener(
  "input",
  (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.matches("[data-money]")) {
      const clean = el.value.replace(/[^\d.,]/g, "");
      if (clean !== el.value) {
        const caret = Math.max(
          0,
          (el.selectionStart ?? clean.length) -
            (el.value.length - clean.length),
        );
        el.value = clean;
        el.setSelectionRange(caret, caret);
      }
      return;
    }
    if (el.dataset.mask && el.selectionStart === el.value.length) {
      const masked =
        el.dataset.mask === "phone"
          ? maskPhone(el.value)
          : maskDocument(el.value);
      if (masked !== el.value) el.value = masked;
    }
  },
  true,
);
document.addEventListener("focusout", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.matches("[data-money]") && !el.readOnly) {
    const value = parseMoney(el.value);
    if (typeof value === "number" && !Number.isNaN(value))
      el.value = formatMoneyInput(value);
  } else if (el.dataset.mask)
    el.value =
      el.dataset.mask === "phone"
        ? maskPhone(el.value)
        : maskDocument(el.value);
});
document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle-password]");
  if (!toggle) return;
  const passwordInput = document.getElementById(toggle.dataset.togglePassword);
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  toggle.innerHTML = `${show ? "Ocultar" : "Mostrar"}<span class="sr-only"> senha</span>`;
});
$("#alert-close").onclick = closeAlert;
// O aviso com "Desfazer" não some enquanto o mouse ou o foco estiverem nele.
const toastBox = $("#toast");
toastBox.addEventListener("mouseenter", () => clearTimeout(toastTimer));
toastBox.addEventListener("focusin", () => clearTimeout(toastTimer));
toastBox.addEventListener(
  "mouseleave",
  () => toastBox.classList.contains("show") && startToastTimer(),
);
toastBox.addEventListener("focusout", (event) => {
  if (
    !toastBox.contains(event.relatedTarget) &&
    toastBox.classList.contains("show")
  )
    startToastTimer();
});
window.addEventListener("beforeunload", (event) => {
  if (
    [...forms.values()].some((ctrl) => ctrl.dialog.open && ctrl.isDirty()) ||
    pageGuard?.()
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function start() {
  try {
    user = await api("/me");
    await load();
  } catch (error) {
    if (error.status === 401) {
      auth();
      return;
    }
    document.title = "Servidor indisponível · AOF Studio";
    root.innerHTML = `<main class="startup" role="alert"><h1>Servidor indisponível</h1><p>A interface abriu, mas não conseguiu se conectar ao servidor do sistema. Confira o terminal onde o servidor foi iniciado.</p><p>Na pasta do projeto, com Node.js 24 instalado, execute:</p><pre>npm ci\nnpm start</pre><p>Depois, mantenha o terminal aberto e acesse <a href="http://localhost:3000">http://localhost:3000</a>.</p><p>Hospedagens estáticas, como GitHub Pages, não executam o servidor Node.js, o banco de dados ou a geração de PDFs.</p><button id="retry-start" type="button">Tentar novamente</button></main>`;
    $("#retry-start").onclick = start;
  }
}
if (location.protocol !== "file:") await start();
