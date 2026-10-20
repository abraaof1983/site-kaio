import { QUOTE_TEMPLATES, dateBeforeEvent } from "./quote-templates.js";
import {
  addDays,
  daysBetween,
  formatMoneyInput,
  maskDocument,
  maskPhone,
  parseMoney,
  splitAmount,
} from "./formatters.js";

const $ = (selector, scope = document) => scope.querySelector(selector),
  $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)],
  root = $("#app"),
  modal = $("#modal"),
  reauthDialog = $("#reauth");
let user,
  state,
  page = "dashboard",
  search = "",
  filter = "all",
  pendingFocus = null, // seletor (ou "heading") que recebe o foco depois do próximo render
  activeForm = null, // controle do formulário aberto no modal
  pageGuard = null, // indica alterações não salvas no formulário da página atual
  reauthPending = null,
  toastTimer,
  errorSeq = 0;

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
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 2 4 3-1 3 3 3-3 3 1 2-4-2-2 1-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>',
  trend: '<path d="m4 17 6-6 4 4 6-7M15 8h5v5"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
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
const shortDate = (v) =>
  v ? v.split("-").reverse().slice(0, 2).join("/") : "";
const statuses = {
  draft: "Rascunho",
  sent: "Enviado",
  approved: "Aprovado",
  signed: "Assinado",
  cancelled: "Cancelado",
};
// Situações calculadas, nunca escolhidas à mão.
const derivedStatuses = { expired: "Vencido", converted: "Convertido" };
const statusLabel = (v) => statuses[v] || derivedStatuses[v] || v;
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

async function api(url, body, { retry = true } = {}) {
  const r = await fetch("/api" + url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Sessão expirada no meio do uso: pede a senha e repete a operação sem perder o formulário.
  if (r.status === 401 && retry && user && !AUTH_ROUTES.includes(url)) {
    await reauthenticate();
    return api(url, body, { retry: false });
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
function toast(message, type = "success") {
  if (type === "error") {
    $("#alert-wrap").classList.add("show");
    $("#alert-close").hidden = false;
    $("#alert").textContent = "";
    requestAnimationFrame(() => ($("#alert").textContent = message));
    return;
  }
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove("show");
    box.textContent = "";
  }, 5000);
}
function closeAlert() {
  $("#alert-wrap").classList.remove("show");
  $("#alert").textContent = "";
  $("#alert-close").hidden = true;
}

// ---------- Campos de formulário ----------
const REQUIRED = ' <span class="req" aria-hidden="true">*</span>';
const describedBy = (id, hint) => (hint ? ` aria-describedby="${id}-hint"` : "");
const hintHtml = (id, hint) =>
  hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : "";
const section = (title) => `<h3 class="form-section">${title}</h3>`;
const LEGEND = '<p class="form-legend">Campos marcados com * são obrigatórios.</p>';

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
function area(label, name, value = "", full = true, { attrs = "", hint = "" } = {}) {
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
    (placeholder != null ? `<option value="">${esc(placeholder)}</option>` : "") +
    options
      .map(
        ([v, l]) =>
          `<option value="${esc(v)}"${String(v) === String(value ?? "") ? " selected" : ""}>${esc(l)}</option>`,
      )
      .join("");
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${required ? REQUIRED : ""}</label><select id="${id}" name="${name}"${required ? " required" : ""}${describedBy(id, hint)}>${opts}</select>${hintHtml(id, hint)}</div>`;
}
function passwordField(id, name, label, autocomplete, attrs = "", full = false) {
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${REQUIRED}</label><div class="input-affix password"><input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required ${attrs}><button type="button" class="toggle-password" data-toggle-password="${id}">Mostrar<span class="sr-only"> senha</span></button></div></div>`;
}

// ---------- Validação acessível (erro no campo + resumo no topo) ----------
function updateCustomValidity(el) {
  if (!el.matches?.("[data-money]")) return;
  const value = parseMoney(el.value);
  el.setCustomValidity(
    el.value.trim() && (value == null || Number.isNaN(value))
      ? "Informe um valor válido, por exemplo 2.900,00."
      : "",
  );
}
function fieldLabel(el) {
  const label = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
  const ids = new Set((el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
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
  const item = document.querySelector(`.error-summary [data-error-for="${errorId}"]`);
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
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement))
      continue;
    if (el.disabled || !el.willValidate) continue;
    updateCustomValidity(el);
    if (!el.checkValidity()) errors.push({ el, message: validationMessage(el) });
  }
  errors.push(...extra);
  for (const error of errors) showError(error);
  if (!errors.length) return true;
  if (host) showSummary(host, errors);
  else errors[0].el.focus();
  return false;
}
function revalidate(el) {
  if (!el?.dataset?.errorId || el.dataset.groupError || !el.willValidate) return;
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
      if (key.startsWith(`aof-draft:${user?.id}:`)) localStorage.removeItem(key);
  } catch {}
}
function focusSelector(el) {
  if (!el || !root.contains(el)) return null;
  for (const attr of ["data-edit-doc", "data-edit-client", "data-edit-package", "data-convert", "data-quote-template", "data-new"])
    if (el.hasAttribute(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
  return null;
}

// ---------- Sessão ----------
function auth(register = false) {
  user = null;
  state = null;
  pageGuard = null;
  document.title = `${register ? "Criar conta" : "Entrar"} · AOF Studio`;
  root.innerHTML = `<div class="auth"><section class="auth-story"><div class="brand"><span class="mark" aria-hidden="true">a</span> AOF studio</div><div><p class="eyebrow">MENOS PAPELADA. MAIS CELEBRAÇÃO.</p><p class="auth-headline">Grandes eventos começam com tudo em ordem.</p><p>Seu próximo capítulo começa aqui. Organize propostas, formalize contratos e cuide do que faz a festa acontecer.</p><div class="auth-art" aria-hidden="true">✳ ── ◌</div></div><small>AOF Serviços · DJ Kaio Jansen</small></section><main class="auth-form"><form id="authform" novalidate><p class="eyebrow">SEU ESCRITÓRIO DE EVENTOS</p><h1>${register ? "Crie sua conta" : "Que bom ter você aqui."}</h1><p class="muted">${register ? "Organização para cada nova celebração." : "Entre para acompanhar seus negócios."}</p>${register ? field("Nome completo", "name", "", "text", true, false, { attrs: 'autocomplete="name"' }) : ""}${field("E-mail", "email", "", "email", true, false, { attrs: 'autocomplete="username"' })}${passwordField("f-password", "password", "Senha", register ? "new-password" : "current-password", register ? 'minlength="10" aria-describedby="password-hint"' : "")}${register ? '<p class="hint" id="password-hint">Use pelo menos 10 caracteres. Sua conta terá seus próprios clientes e documentos.</p>' : ""}<div class="error" id="autherror" role="alert"></div><button type="submit" class="primary">${register ? "Criar minha conta" : "Entrar na minha conta"} <span aria-hidden="true">→</span></button><button class="auth-switch" type="button">${register ? "Já tenho uma conta. Entrar" : "Primeiro acesso? Criar uma conta"}</button></form></main></div>`;
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
      user = await api(register ? "/register" : "/login", Object.fromEntries(new FormData(form)));
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
          Error("Sua sessão expirou. Entre novamente para salvar: o que você digitou continua no formulário."),
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
  page = "dashboard";
  auth();
}

// ---------- Documentos ----------
function docs(type) {
  return state.documents.filter((d) => !type || d.type === type);
}
const findDoc = (id) => state.documents.find((d) => d.id === Number(id));
const contractFor = (quote) =>
  quote && state.documents.find((d) => d.type === "contract" && d.sourceId === quote.id);
function displayStatus(d) {
  if (d.type === "quote") {
    if (contractFor(d)) return "converted";
    if (["draft", "sent"].includes(d.status) && d.validUntil && d.validUntil < today())
      return "expired";
  }
  return d.status;
}
function validityNote(d, status) {
  if (!["draft", "sent", "expired"].includes(status) || !d.validUntil) return "";
  const days = daysBetween(today(), d.validUntil);
  if (days == null) return "";
  if (days < 0) return `<small class="doc-note late">Venceu em ${shortDate(d.validUntil)}</small>`;
  if (days === 0) return '<small class="doc-note warn">Vence hoje</small>';
  if (days <= 3)
    return `<small class="doc-note warn">Vence em ${days} ${days === 1 ? "dia" : "dias"}</small>`;
  return `<small class="doc-note">Válido até ${shortDate(d.validUntil)}</small>`;
}
const labels = {
  dashboard: "Visão geral",
  quotes: "Orçamentos",
  contracts: "Contratos",
  clients: "Clientes",
  packages: "Pacotes e preços",
  settings: "Configurações",
};
const newButton = (kind, label, primary = true) =>
  `<button type="button"${primary ? ' class="primary"' : ""} data-new="${kind}"><span aria-hidden="true">＋</span> ${label}</button>`;

function render() {
  pageGuard = null;
  document.title = `${labels[page]} · AOF Studio`;
  const contractCount = docs("contract").length;
  root.innerHTML = `<a class="skip-link" href="#conteudo" data-action="skip">Pular para o conteúdo</a><div class="shell"><div class="sidebar"><div class="brand"><span class="mark" aria-hidden="true">a</span><div class="brand-text">aof<span class="brand-soft">studio</span><small>GESTÃO DE EVENTOS</small></div></div><p class="nav-label" id="nav-label">ESPAÇO DE TRABALHO</p><nav class="nav" aria-labelledby="nav-label">${Object.entries(
    labels,
  )
    .map(
      ([k, l]) =>
        `<button type="button" data-page="${k}" class="${page === k ? "active" : ""}"${page === k ? ' aria-current="page"' : ""} title="${l}">${icon(k)}<span class="label">${l}</span>${k === "contracts" && contractCount ? `<span class="count">${contractCount}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="side-bottom"><div class="userline"><span class="avatar" aria-hidden="true">${initial()}</span><div class="user-meta"><strong>${esc(firstName())}</strong><small>${esc(user.email)}</small></div><button type="button" class="logout" data-action="logout" aria-label="Sair da conta" title="Sair">${icon("logout")}<span>Sair</span></button></div></div></div><div class="main"><header class="topbar"><p class="crumbs">Seu espaço <span aria-hidden="true">/</span> <strong>${labels[page]}</strong></p></header><main class="content" id="conteudo" tabindex="-1">${content()}</main></div></div>`;
  if (page === "settings") bindSettings();
  const focus = pendingFocus;
  pendingFocus = null;
  if (focus) ((focus !== "heading" && root.querySelector(focus)) || root.querySelector("h1"))?.focus();
}
function head(title, description, buttons = "") {
  return `<div class="page-head"><div><h1 tabindex="-1">${title}</h1><p>${description}</p></div><div class="actions">${buttons}</div></div>`;
}
function content() {
  if (page === "dashboard") return dashboard();
  if (page === "settings") return settings();
  if (page === "clients")
    return (
      head("Clientes", "Dados de contato usados nos orçamentos e contratos.", newButton("client", "Novo cliente")) +
      toolbar() +
      `<div class="panel" id="list">${clientTable()}</div>`
    );
  if (page === "packages")
    return (
      head(
        "Pacotes e preços",
        "Serviços, equipamentos e valores de referência para os orçamentos.",
        newButton("package", "Novo pacote"),
      ) +
      `<div class="list-cards">${state.packages.map(packageCard).join("") || empty("Seu primeiro pacote", "Cadastre os serviços, equipamentos e o preço de cada experiência.", "package", "Criar pacote")}</div>`
    );
  const isQ = page === "quotes",
    kind = isQ ? "quote" : "contract";
  return (
    head(
      isQ ? "Orçamentos" : "Contratos",
      isQ
        ? "Crie propostas, acompanhe a validade e gere contratos."
        : "Revise cláusulas, condições e assinaturas de cada evento.",
      newButton(kind, isQ ? "Novo orçamento" : "Novo contrato"),
    ) +
    (isQ ? quoteGallery() : "") +
    toolbar(kind) +
    `<div class="panel" id="list">${docTable(docs(kind), kind)}</div>`
  );
}
const packageCard = (p) =>
  `<article class="panel package-detail"><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p class="price">${money(p.price)}</p><p class="equipment">${esc(p.equipment)}</p><button type="button" data-edit-package="${p.id}">Editar pacote<span class="sr-only"> ${esc(p.name)}</span></button></article>`;
function quoteGallery() {
  const templates = state.quoteTemplates || QUOTE_TEMPLATES;
  return `<section class="quote-gallery" aria-labelledby="quote-models-title"><div class="quote-gallery-heading"><div><h2 id="quote-models-title">Modelos prontos para impressionar</h2><p>Escolha o espaço, personalize os detalhes e gere um PDF com sua marca.</p></div><span class="quote-gallery-badge">${templates.length} modelos incluídos</span></div><div class="quote-models">${templates
    .map(
      (t, i) =>
        `<article class="quote-model"><div class="quote-model-cover"><img class="quote-model-photo" src="/quote-assets/estrutura.png" alt="" loading="lazy"><div class="quote-model-shade"></div><img class="quote-model-logo" src="/quote-assets/logo.jpg" alt=""><span class="quote-model-number" aria-hidden="true">MODELO ${String(i + 1).padStart(2, "0")}</span><h3 class="quote-model-title">${esc(t.name)}</h3></div><div class="quote-model-body"><p>${esc(t.description)}</p><div class="quote-model-tags"><span>PDF com fotos e marca</span><span>${t.offers.length > 1 ? `${t.offers.length} opções de serviço` : "Pacote completo"}</span></div><button type="button" data-quote-template="${esc(t.id)}">Usar modelo<span class="sr-only"> ${esc(t.name)}</span> ${icon("arrow")}</button></div></article>`,
    )
    .join("")}</div></section>`;
}
function toolbar(kind = null) {
  const options =
    kind === "quote"
      ? ["draft", "sent", "approved", "cancelled", "expired", "converted"]
      : ["draft", "sent", "approved", "signed", "cancelled"];
  return `<div class="toolbar" role="search"><label class="sr-only" for="search">Buscar</label><input type="search" id="search" placeholder="${kind ? "Buscar cliente, evento ou nº" : "Buscar por nome ou e-mail"}" value="${esc(search)}" autocomplete="off">${
    kind
      ? `<label class="sr-only" for="statusfilter">Filtrar por situação</label><select id="statusfilter"><option value="all">Todas as situações</option>${options
          .map((v) => `<option value="${v}"${filter === v ? " selected" : ""}>${statusLabel(v)}</option>`)
          .join("")}</select>`
      : ""
  }<p class="sr-only" id="results-status" role="status"></p></div>`;
}
function empty(title, description, kind, label) {
  return `<div class="empty"><div class="empty-symbol" aria-hidden="true">◇</div><h3>${title}</h3><p>${description}</p>${kind ? newButton(kind, label) : ""}</div>`;
}
function dashboard() {
  const contracts = docs("contract"),
    quotes = docs("quote"),
    active = contracts.filter((d) => ["sent", "approved", "signed"].includes(d.status)),
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
      newButton("contract", "Novo contrato", false) + newButton("quote", "Novo orçamento"),
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
    )}</div><div class="grid"><div><section class="panel"><div class="panel-title"><h2>Documentos recentes</h2><button type="button" class="link-button" data-page="contracts">Ver contratos</button></div>${docTable(state.documents.slice(0, 6), null, { compact: true })}</section><section class="panel panel-gap"><div class="panel-title"><h2>Próximos eventos</h2><span>Contratos com data a partir de hoje</span></div>${eventList()}</section></div><aside class="aside-cards" aria-label="Catálogo de pacotes"><section class="panel"><div class="panel-title"><h2>Seu catálogo de experiências</h2></div>${
      pk
        ? `<div class="package-box"><p class="package-label">EM DESTAQUE</p><h3>${esc(pk.name)}</h3><p class="price">${money(pk.price)}</p><p class="package-desc">${esc(pk.description)}</p><ul>${String(pk.equipment || "")
            .split("\n")
            .filter(Boolean)
            .slice(0, 4)
            .map((x) => `<li>${esc(x)}</li>`)
            .join("")}</ul><button type="button" data-page="packages">Gerenciar pacotes</button></div>`
        : empty("Monte seu catálogo", "Crie seu primeiro pacote.", "package", "Criar pacote")
    }</section></aside></div>`
  );
}
function eventList() {
  const list = docs("contract")
    .filter((d) => d.date >= today() && d.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  return list.length
    ? `<ul class="event-list">${list
        .map(
          (d) =>
            `<li><span class="badge approved">${date(d.date)}</span><div><strong>${esc(d.event)}</strong><small>${esc(d.venue || "Local a definir")}</small></div></li>`,
        )
        .join("")}</ul>`
    : empty("A agenda está aberta", "Os próximos eventos dos seus contratos aparecerão aqui.");
}
function docTable(list, kind = null, { compact = false } = {}) {
  const term = search.trim().toLowerCase();
  const visible = list.filter(
    (d) =>
      `${d.client?.name || ""} ${d.event || ""} ${d.number || ""}`.toLowerCase().includes(term) &&
      (filter === "all" || displayStatus(d) === filter),
  );
  if (!visible.length) {
    if (list.length)
      return '<div class="empty"><h3>Nenhum documento encontrado</h3><p>Nenhum resultado para a busca ou a situação selecionada.</p><button type="button" data-action="clear-filters">Limpar busca e filtros</button></div>';
    return kind === "contract"
      ? empty("Nenhum contrato ainda", "Gere um contrato a partir de um orçamento ou crie um do zero.", "contract", "Novo contrato")
      : empty("Sua próxima história começa aqui", "Crie um orçamento, combine os detalhes e transforme em contrato.", "quote", "Criar primeiro orçamento");
  }
  const row = (d) => {
    const status = displayStatus(d),
      isQuote = d.type === "quote",
      contract = isQuote ? contractFor(d) : null,
      source = !isQuote && d.sourceId ? findDoc(d.sourceId) : null,
      context = `<span class="sr-only">: ${esc(d.client?.name)}, ${esc(d.event)}</span>`;
    // No painel, só as ações mais usadas; as demais ficam nas páginas de cada lista.
    const more = compact
      ? ""
      : `<button type="button" data-pdf="${d.id}">Baixar PDF${context}</button>${
          isQuote
            ? contract
              ? `<button type="button" data-edit-doc="${contract.id}">Ver contrato${context}</button>`
              : `<button type="button" class="soft" data-convert="${d.id}">Gerar contrato${context}</button>`
            : ""
        }`;
    const preview = compact ? '<span class="sr-only">Visualizar </span>PDF' : "Visualizar PDF";
    return `<tr><td><strong>${esc(d.client?.name)}</strong><small>${esc(d.event)} · ${isQuote ? "Orçamento" : "Contrato"} <span class="doc-number">${esc(d.number || "")}</span></small>${source ? `<small>Gerado do orçamento <span class="doc-number">${esc(source.number)}</span></small>` : ""}</td><td>${date(d.date)}</td><td>${money(d.total)}</td><td>${badge(status)}${isQuote ? validityNote(d, status) : ""}</td><td><div class="rowactions"><button type="button" data-edit-doc="${d.id}">Editar${context}</button><button type="button" data-preview-pdf="${d.id}">${preview}<span class="sr-only"> (abre em nova aba)</span>${context} <span aria-hidden="true">↗</span></button>${more}</div></td></tr>`;
  };
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Cliente / evento</th><th scope="col">Data</th><th scope="col">Valor</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>${visible.map(row).join("")}</tbody></table></div>`;
}
function clientTable() {
  const term = search.trim().toLowerCase();
  const list = state.clients.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(term));
  if (!list.length)
    return state.clients.length
      ? '<div class="empty"><h3>Nenhum cliente encontrado</h3><p>Nenhum resultado para a busca.</p><button type="button" data-action="clear-filters">Limpar busca</button></div>'
      : empty("Conheça seu próximo cliente", "Cadastre nome, contato e os dados necessários para os documentos.", "client", "Cadastrar cliente");
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Contato</th><th scope="col">CPF / CNPJ</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${list
    .map(
      (c) =>
        `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.document)}</td><td><button type="button" data-edit-client="${c.id}">Editar<span class="sr-only"> ${esc(c.name)}</span></button></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function refreshList() {
  const list = $("#list");
  if (!list) return;
  if (page === "clients") list.innerHTML = clientTable();
  else {
    const kind = page === "quotes" ? "quote" : "contract";
    list.innerHTML = docTable(docs(kind), kind);
  }
  const rows = $$("tbody tr", list).length,
    status = $("#results-status");
  if (status)
    status.textContent = rows ? `${rows} ${rows === 1 ? "resultado" : "resultados"}` : "Nenhum resultado";
}

// ---------- Configurações ----------
function settings() {
  const c = state.settings;
  return (
    head("Configurações", "Dados da empresa, contato e cláusulas usados nos novos documentos.") +
    `<section class="panel settings-panel"><div class="notice">As cláusulas foram adaptadas dos documentos enviados. Revise o texto com assessoria jurídica antes do uso. Alterações aqui valem para novos documentos; os já emitidos mantêm os dados registrados.</div><form id="settingsform" novalidate><div class="form-alerts"></div>${LEGEND}<div class="form-grid">${field("Empresa", "company", c.company, "text", true, false, { attrs: 'autocomplete="organization"' })}${field("Representante", "representative", c.representative, "text", false, false, { attrs: 'autocomplete="name"' })}${field("CNPJ", "cnpj", maskDocument(c.cnpj), "text", false, false, { attrs: 'data-mask="document" autocomplete="off"' })}${field("E-mail", "email", c.email, "email", false, false, { attrs: 'autocomplete="email"' })}${field("WhatsApp comercial", "phone", maskPhone(c.phone), "tel", true, false, { attrs: 'data-mask="phone" autocomplete="tel"', hint: "Aparece no orçamento para o cliente confirmar a contratação." })}${field("Chave PIX", "pix", c.pix, "text", false, false, { attrs: 'autocomplete="off"', hint: "Aparece no orçamento junto com as instruções para contratar." })}${field("Endereço", "address", c.address, "text", false, true, { attrs: 'autocomplete="street-address"' })}${field("Validade padrão dos orçamentos (dias)", "quoteValidityDays", c.quoteValidityDays ?? DEFAULT_VALIDITY_DAYS, "number", true, false, { attrs: 'min="1" max="365" step="1" inputmode="numeric"', hint: "Sugere a data de validade de cada novo orçamento." })}${area("Cláusulas padrão (editáveis)", "clauses", c.clauses, true, { attrs: 'rows="16"' })}</div><button type="submit" class="primary settings-save">Salvar configurações</button></form></section>`
  );
}
function bindSettings() {
  const form = $("#settingsform");
  if (!form) return;
  const initialState = comparable(form);
  pageGuard = () => comparable(form) !== initialState;
  const host = $(".form-alerts", form);
  form.addEventListener("input", (event) => revalidate(event.target));
  form.addEventListener("change", (event) => revalidate(event.target));
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!validateForm(form, { host })) return;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    button.textContent = "Salvando…";
    try {
      const values = Object.fromEntries(new FormData(form));
      await api("/records/settings", {
        ...state.settings,
        ...values,
        quoteValidityDays: Number(values.quoteValidityDays),
        id: state.settings.id,
      });
      pageGuard = null;
      pendingFocus = "heading";
      await load();
      toast("Configurações salvas.");
    } catch (error) {
      showSummary(host, [{ message: error.message }], "Não foi possível salvar");
      button.disabled = false;
      button.textContent = "Salvar configurações";
    }
  };
}

// ---------- Modal de formulário ----------
function openModal(title, html, onSubmit, { onSaved, submitLabel = "Salvar", draft = null, notice = "" } = {}) {
  const returnFocus = focusSelector(document.activeElement);
  modal.setAttribute("aria-labelledby", "modal-title");
  modal.innerHTML = `<form id="modalform" novalidate><div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div><div class="modal-body"><div class="form-alerts"></div>${notice ? `<div class="modal-notice">${notice}</div>` : ""}${LEGEND}<div class="form-grid">${html}</div></div><div class="modal-foot"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">${submitLabel}</button></div></form>`;
  const form = $("#modalform"),
    alerts = $(".form-alerts", form);
  let pristine = "";
  const saveDraftNow = () => {
    if (!draft || activeForm !== ctrl) return;
    try {
      if (ctrl.isDirty())
        localStorage.setItem(draft, JSON.stringify({ savedAt: Date.now(), values: formValues(form) }));
      else localStorage.removeItem(draft);
    } catch {}
  };
  const saveDraft = debounce(saveDraftNow, 400);
  const ctrl = {
    form,
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
        $(".form-grid input, .form-grid select, .form-grid textarea", form)?.focus();
      });
    },
  };
  activeForm = ctrl;
  const close = () => {
    ctrl.discardDraft();
    activeForm = null;
    modal.close();
  };
  const requestClose = () => {
    if (!ctrl.isDirty() || confirm(DISCARD_MESSAGE)) close();
  };
  $$("[data-close]", form).forEach((button) => (button.onclick = requestClose));
  modal.oncancel = (event) => {
    if (activeForm !== ctrl) return;
    if (!ctrl.isDirty()) return ctrl.discardDraft();
    if (event.cancelable) {
      event.preventDefault();
      requestClose();
      return;
    }
    // O navegador pode impedir o cancelamento do Esc repetido: o rascunho fica guardado.
    saveDraftNow();
    activeForm = null;
    if (draft)
      setTimeout(() => toast("Formulário fechado. Suas alterações ficaram guardadas como rascunho neste navegador."), 0);
  };
  modal.onclose = () => {
    if (activeForm === ctrl && !modal.open) activeForm = null;
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
    if (!validateForm(form, { host: alerts, extra: ctrl.extraValidation() })) return;
    const button = $('button[type="submit"]', form),
      label = button.textContent;
    button.disabled = true;
    button.textContent = "Salvando…";
    try {
      const saved = await onSubmit(Object.fromEntries(new FormData(form)));
      close();
      pendingFocus = returnFocus || "heading";
      await load();
      toast("Salvo com sucesso.");
      onSaved?.(saved);
    } catch (error) {
      if (modal.open) showSummary(alerts, [{ message: error.message }], "Não foi possível salvar");
      else toast(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };
  modal.showModal();
  ctrl.markPristine();
  return ctrl;
}
function editClient(c = {}, onSaved, { notice = "" } = {}) {
  openModal(
    c.id ? "Editar cliente" : "Novo cliente",
    field("Nome completo", "name", c.name, "text", true, false, { attrs: 'autocomplete="off"' }) +
      field("CPF / CNPJ", "document", maskDocument(c.document), "text", false, false, {
        attrs: 'data-mask="document" autocomplete="off"',
        hint: "Usado no contrato. Não aparece no orçamento.",
      }) +
      field("E-mail", "email", c.email, "email", false, false, { attrs: 'autocomplete="off"' }) +
      field("Telefone / WhatsApp", "phone", maskPhone(c.phone), "tel", false, false, {
        attrs: 'data-mask="phone" autocomplete="off"',
      }) +
      field("Endereço completo", "address", c.address, "text", false, true, {
        attrs: 'autocomplete="off"',
        hint: "Usado no contrato.",
      }),
    (b) => api("/records/clients", { ...b, id: c.id }),
    { onSaved, submitLabel: "Salvar cliente", notice },
  );
}
function editPackage(p = {}) {
  openModal(
    p.id ? "Editar pacote" : "Novo pacote",
    field("Nome do pacote", "name", p.name, "text", true) +
      moneyField("Preço", "price", p.price, true) +
      area("Descrição", "description", p.description) +
      area("Equipamentos e serviços", "equipment", p.equipment, true, { hint: "Um item por linha." }),
    (b) => api("/records/packages", { ...b, id: p.id, price: parseMoney(b.price) }),
    { submitLabel: "Salvar pacote" },
  );
}
function editDoc(type, d = {}, { notice = "" } = {}) {
  if (!state.clients.length && !d.id) {
    page = "clients";
    render();
    editClient(
      {},
      (client) => {
        page = type === "quote" ? "quotes" : "contracts";
        render();
        editDoc(type, { ...d, clientId: client.id });
      },
      {
        notice: `Cadastre o cliente primeiro. Em seguida, o ${type === "quote" ? "orçamento" : "contrato"} abre com ele selecionado.`,
      },
    );
    return;
  }
  const isQuote = type === "quote",
    isNew = !d.id,
    templates = state.quoteTemplates || QUOTE_TEMPLATES,
    // Novo orçamento começa sem modelo: local e preços do modelo só entram por escolha explícita.
    template = isQuote ? templates.find((t) => t.id === d.templateId) : undefined,
    initialOffer = template?.offers.find((o) => o.id === d.offerId) || template?.offers[0],
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
    equipment: offer.equipment,
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
  const data = template && isNew ? { ...templateDefaults(template, initialOffer), ...d } : { ...d };
  if (isQuote && isNew && !data.validUntil) data.validUntil = addDays(today(), validityDays());
  // Sem cliente pré-selecionado: a escolha é sempre explícita.
  const selectedClientId = d.clientId ?? d.client?.id ?? "";
  const clientOptions = state.clients.map((client) => [client.id, client.name]);
  if (d.client && !clientOptions.some(([id]) => String(id) === String(selectedClientId)))
    clientOptions.unshift([selectedClientId, `${d.client.name} (dados do documento)`]);
  const num = (index) => String(isQuote ? index + 1 : index).padStart(2, "0");
  const quoteFields = isQuote
    ? `${section("01 · Modelo do orçamento")}${select(
        "Modelo visual",
        "templateId",
        [["", "Personalizado (sem modelo)"], ...templates.map((t) => [t.id, t.name])],
        template?.id || "",
        false,
        { full: true, hint: "Os modelos trazem marca, foto da estrutura, local e condições comerciais. Todos os valores continuam editáveis." },
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
      )}${field("Máximo de parcelas no cartão", "installmentCount", data.installmentCount ?? 0, "number", true, false, {
        attrs: 'min="0" max="36" step="1" inputmode="numeric"',
        hint: "Use 0 para parcelamento a combinar.",
      })}${select(
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
  const html = `${quoteFields}${section(`${num(1)} · Cliente e evento`)}${select(
    "Cliente",
    "clientId",
    clientOptions,
    selectedClientId,
    true,
    { placeholder: "Selecione o cliente" },
  )}${select(
    "Situação",
    "status",
    Object.entries(statuses).filter(([v]) => type === "contract" || v !== "signed"),
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
  )}${field("Término", "end", data.end, "time", false, false, { hint: "Pode ser no dia seguinte." })}${section(
    `${num(2)} · Serviços e valores`,
  )}${select(
    "Pacote de referência",
    "packageId",
    [["", "Personalizado"], ...state.packages.map((pk) => [pk.id, pk.name])],
    template ? "" : isNew ? (data.packageId ?? p.id) : data.packageId,
  )}${field("Nome do pacote / serviço", "packageName", data.packageName ?? p.name, "text", true)}${area(
    "Equipamentos e serviços incluídos",
    "equipment",
    data.equipment ?? p.equipment,
    true,
    { hint: "Um item por linha." },
  )}${quotePriceFields}${moneyField("Valor total do documento", "total", data.total ?? p.price, true)}${moneyField(
    "Hora adicional",
    "extraHour",
    data.extraHour ?? 500,
  )}${
    isQuote
      ? field("Validade do orçamento", "validUntil", data.validUntil, "date", true, false, {
          hint: "Depois desta data, o orçamento aparece como Vencido.",
        })
      : ""
  }${paymentsBlock}${area("Forma de pagamento e condições", "paymentNotes", data.paymentNotes ?? "Pagamento via PIX ou dinheiro.")}${section(
    `${num(3)} · Condições do documento`,
  )}${
    type === "contract"
      ? area("Cláusulas contratuais (revise antes de emitir)", "clauses", data.clauses ?? state.settings.clauses, true, {
          attrs: 'rows="16"',
        })
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
    const optionalNumber = (value) => (value == null || value === "" ? null : Number(value));
    const selectedTemplate = isQuote && templates.find((t) => t.id === b.templateId);
    const quoteValues = isQuote
      ? {
          templateId: selectedTemplate?.id || null,
          offerId: selectedTemplate ? b.offerId || null : null,
          quoteHeadline: selectedTemplate ? b.quoteHeadline?.trim() || null : null,
          introduction: selectedTemplate ? b.introduction?.trim() || null : null,
          cashTotal: selectedTemplate ? optionalMoney(b.cashTotal) : null,
          installmentTotal: selectedTemplate ? optionalMoney(b.installmentTotal) : null,
          installmentCount: selectedTemplate ? optionalNumber(b.installmentCount) : null,
          paymentChoice: selectedTemplate ? b.paymentChoice : null,
          cardTerms: selectedTemplate ? b.cardTerms?.trim() || null : null,
        }
      : {};
    let total = optionalMoney(b.total);
    if (selectedTemplate) {
      total =
        quoteValues.paymentChoice === "installments" ? quoteValues.installmentTotal : quoteValues.cashTotal;
      if (total == null) throw Error("Informe o valor da condição de pagamento escolhida.");
    }
    // Parte do documento original para não perder campos que não estão no formulário
    // (por exemplo, o vínculo do contrato com o orçamento de origem).
    return api("/records/documents", {
      ...d,
      ...b,
      ...quoteValues,
      id: d.id,
      type,
      client: { ...client },
      total: total ?? 0,
      extraHour: optionalMoney(b.extraHour) ?? 0,
      imageConsent: b.imageConsent === "on",
      clauses: b.clauses || d.clauses || state.settings.clauses,
      payments,
    });
  };
  const ctrl = openModal(`${isNew ? "Novo" : "Editar"} ${isQuote ? "orçamento" : "contrato"}`, html, onSubmit, {
    submitLabel: `Salvar ${isQuote ? "orçamento" : "contrato"}`,
    draft: draftKey(type, d.id),
    notice,
  });
  const form = ctrl.form,
    paymentList = $("#payments", form),
    input = (name) => $(`#f-${name}`, form);
  const setValue = (name, value) => {
    const el = input(name);
    if (!el) return;
    el.value = el.matches("[data-money]") ? formatMoneyInput(value) : (value ?? "");
  };
  const moneyValue = (name) => {
    const value = parseMoney(input(name)?.value);
    return value == null || Number.isNaN(value) ? null : value;
  };
  const sameCents = (a, b) => Math.round(a * 100) === Math.round(b * 100);

  // Vencimentos com soma em tempo real.
  const clearPaymentError = () => clearError($("[data-group-error]", form));
  const renumberPayments = () => {
    const rows = $$(".payment-row", paymentList);
    rows.forEach((row, i) => {
      $('[type="date"]', row).setAttribute("aria-label", `Vencimento da parcela ${i + 1}`);
      $("[data-money]", row).setAttribute("aria-label", `Valor da parcela ${i + 1} em reais`);
      $("[data-remove-payment]", row).setAttribute("aria-label", `Remover parcela ${i + 1}`);
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
    const sum = rows.reduce((s, row) => s + (parseMoney($("[data-money]", row).value) || 0), 0);
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
    for (const invalid of $$("[data-error-id]", button.closest(".payment-row"))) clearError(invalid);
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
      showError({ el: input("total"), message: "Informe o valor total antes de distribuir as parcelas." });
      input("total").focus();
      return;
    }
    splitAmount(total, rows.length).forEach((value, i) => {
      const amount = $("[data-money]", rows[i]);
      amount.value = formatMoneyInput(value);
      if (amount.dataset.errorId && !amount.dataset.groupError) clearError(amount);
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
    setValue("equipment", pk.equipment);
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
    const intValue = (name) => (input(name).value === "" ? null : Number(input(name).value));
    updatePrice = (updateCard = false) => {
      const active = Boolean(input("templateId").value);
      $("#quote-template-fields", form).hidden = !active;
      $("#quote-price-fields", form).hidden = !active;
      for (const id of ["quote-template-fields", "quote-price-fields"])
        $$(`#${id} input, #${id} select, #${id} textarea`, form).forEach((el) => (el.disabled = !active));
      input("packageId").disabled = active;
      input("total").readOnly = active;
      const hasInstallments = moneyValue("installmentTotal") !== null;
      $('[value="installments"]', input("paymentChoice")).disabled = !hasInstallments;
      if (!hasInstallments) input("paymentChoice").value = "cash";
      if (active) {
        const selectedPrice = moneyValue(
          input("paymentChoice").value === "installments" ? "installmentTotal" : "cashTotal",
        );
        setValue("total", selectedPrice ?? "");
        if (updateCard)
          setValue(
            "cardTerms",
            hasInstallments ? cardTerms(moneyValue("installmentTotal"), intValue("installmentCount") || 0) : "",
          );
      }
      const boletoDate = dateBeforeEvent(input("date").value);
      $("#quote-payment-helper", form).textContent = `O total do documento acompanha a condição escolhida. ${boletoDate ? `Boleto: vencimento até ${date(boletoDate)}, 10 dias antes do evento.` : "Defina a data do evento para calcular o vencimento do boleto (10 dias antes)."}`;
      updatePaymentSum();
    };
    input("templateId").onchange = () => {
      const selected = templates.find((t) => t.id === input("templateId").value);
      fillOffers(selected);
      if (selected)
        for (const [name, value] of Object.entries(templateDefaults(selected, selected.offers[0])))
          setValue(name, value);
      updatePrice();
    };
    input("offerId").onchange = () => {
      const selected = templates.find((t) => t.id === input("templateId").value);
      const offer = selected?.offers.find((o) => o.id === input("offerId").value);
      if (!offer) return;
      for (const [name, value] of Object.entries({
        packageName: offer.name,
        equipment: offer.equipment,
        cashTotal: offer.cashPrice,
        installmentTotal: offer.installmentPrice,
        installmentCount: offer.installmentCount,
        cardTerms: offer.installmentPrice == null ? "" : cardTerms(offer.installmentPrice, offer.installmentCount),
        paymentNotes: offerPaymentNotes(offer),
        notes: [offer.description, selected.reservationNotes].filter(Boolean).join("\n\n"),
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
    for (const [dateValue, amount] of values.__payments || []) addPayment({ date: dateValue, amount });
    updatePrice();
  };

  for (const payment of data.payments || []) addPayment(payment);
  updatePrice();
  ctrl.markPristine();
  ctrl.offerDraft(fillForm);
}
async function convertQuote(id, button) {
  const quote = findDoc(id);
  if (!quote) return;
  const existing = contractFor(quote);
  if (existing) {
    editDoc("contract", existing, {
      notice: `Este orçamento já tem o contrato <strong>${esc(existing.number)}</strong>. Revise os dados e salve.`,
    });
    return;
  }
  button.disabled = true;
  try {
    const contract = await api(`/documents/${quote.id}/convert`, {});
    page = "contracts";
    search = "";
    filter = "all";
    pendingFocus = `[data-edit-doc="${contract.id}"]`;
    await load();
    const fresh = findDoc(contract.id) || contract;
    editDoc("contract", fresh, {
      notice: `Contrato <strong>${esc(fresh.number)}</strong> gerado a partir do orçamento ${esc(quote.number)}. Revise cláusulas, horários e pagamento e salve.`,
    });
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

// ---------- Navegação e eventos ----------
function navigate(target) {
  if (pageGuard?.() && !confirm(LEAVE_MESSAGE)) return;
  page = target;
  search = "";
  filter = "all";
  pendingFocus = "heading";
  render();
}
function onRootClick(event) {
  const target = event.target.closest("button, a");
  if (!target || !root.contains(target)) return;
  const ds = target.dataset;
  if (ds.action === "skip") {
    event.preventDefault();
    $("#conteudo")?.focus();
    return;
  }
  if (ds.action === "logout") return logout();
  if (ds.action === "clear-filters") {
    search = "";
    filter = "all";
    if ($("#search")) $("#search").value = "";
    if ($("#statusfilter")) $("#statusfilter").value = "all";
    refreshList();
    $("#search")?.focus();
    return;
  }
  if (ds.page) return navigate(ds.page);
  if (ds.new)
    return ds.new === "client" ? editClient() : ds.new === "package" ? editPackage() : editDoc(ds.new);
  if (ds.quoteTemplate) return editDoc("quote", { templateId: ds.quoteTemplate });
  if (ds.editClient) return editClient(state.clients.find((c) => c.id === Number(ds.editClient)));
  if (ds.editPackage) return editPackage(state.packages.find((p) => p.id === Number(ds.editPackage)));
  if (ds.editDoc) {
    const doc = findDoc(ds.editDoc);
    if (doc) editDoc(doc.type, doc);
    return;
  }
  if (ds.previewPdf) {
    window.open(`/api/documents/${ds.previewPdf}/pdf?inline=1`, "_blank", "noopener,noreferrer");
    return;
  }
  if (ds.pdf) {
    const link = document.createElement("a");
    link.href = `/api/documents/${ds.pdf}/pdf`;
    link.download = "";
    link.click();
    return;
  }
  if (ds.convert) return convertQuote(Number(ds.convert), target);
}
root.addEventListener("click", onRootClick);
root.addEventListener("input", (event) => {
  if (event.target.id !== "search") return;
  search = event.target.value;
  refreshList();
});
root.addEventListener("change", (event) => {
  if (event.target.id !== "statusfilter") return;
  filter = event.target.value;
  refreshList();
});
// Máscaras: filtram o que é digitado e formatam ao sair do campo.
document.addEventListener(
  "input",
  (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.matches("[data-money]")) {
      const clean = el.value.replace(/[^\d.,]/g, "");
      if (clean !== el.value) {
        const caret = Math.max(0, (el.selectionStart ?? clean.length) - (el.value.length - clean.length));
        el.value = clean;
        el.setSelectionRange(caret, caret);
      }
      return;
    }
    if (el.dataset.mask && el.selectionStart === el.value.length) {
      const masked = el.dataset.mask === "phone" ? maskPhone(el.value) : maskDocument(el.value);
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
    if (typeof value === "number" && !Number.isNaN(value)) el.value = formatMoneyInput(value);
  } else if (el.dataset.mask)
    el.value = el.dataset.mask === "phone" ? maskPhone(el.value) : maskDocument(el.value);
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
window.addEventListener("beforeunload", (event) => {
  if ((modal.open && activeForm?.isDirty()) || pageGuard?.()) {
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
