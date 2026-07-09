/* shared-header.js — cabecalho compartilhado /admin e /escala-spa.html */
(function () {
  "use strict";

  var STYLE_ID = "shared-header-style";

  var CSS = [
    ":root, :root[data-theme=\"light\"] {",
    "  --header-bg: rgba(244,238,225,0.82);",
    "  --logo-filter: none;",
    "  --gold-dark: #7A4334;",
    "  --muted2: #44402F;",
    "}",
    ":root[data-theme=\"dark\"] {",
    "  --header-bg: rgba(10,14,26,0.72);",
    "  --logo-filter: brightness(0) invert(1);",
    "  --gold-dark: #7A4334;",
    "  --muted2: #C8B89A;",
    "}",
    "header {",
    "  background: var(--header-bg);",
    "  backdrop-filter: blur(10px);",
    "  -webkit-backdrop-filter: blur(10px);",
    "  border-bottom: 1px solid var(--border);",
    "  padding: 0 2.5rem;",
    "  height: 64px;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  position: sticky;",
    "  top: 0;",
    "  z-index: 100;",
    "  flex-shrink: 0;",
    "}",
    "header.sh-ctx-escala { position: relative; z-index: 90; }",
    "header::after {",
    "  content: \"\";",
    "  position: absolute;",
    "  bottom: -1px;",
    "  left: 2.5rem;",
    "  width: 40px;",
    "  height: 2px;",
    "  background: var(--gold);",
    "}",
    ".header-brand { display: flex; align-items: center; gap: 1.25rem; text-decoration: none; color: inherit; cursor: pointer; }",
    ".header-brand .brand-logo { height: 32px; width: auto; filter: var(--logo-filter, none); transition: filter 0.3s ease; }",
    ".header-brand .sep { width: 1px; height: 20px; background: var(--border); }",
    ".header-brand small { font-size: 0.75rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }",
    ".header-actions { display: flex; align-items: center; gap: 0.5rem; }",
    ".btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5625rem 1.125rem; font-size: 0.75rem; font-weight: 500; cursor: pointer; border: none; font-family: var(--font); letter-spacing: .09em; text-transform: uppercase; transition: opacity .15s, background .15s; border-radius: 0; white-space: nowrap; }",
    ".btn:hover { opacity: .82; }",
    ".btn-outline { background: transparent; border: 1px solid var(--border); color: var(--muted2, var(--muted)); }",
    ".btn-outline:hover { border-color: var(--gold); color: var(--gold); opacity: 1; }",
    ".btn-sm { padding: 0.3125rem 0.75rem; font-size: 0.7rem; }",
    ".admin-dropdown { position: relative; }",
    ".admin-dropdown-menu { display: none; position: absolute; top: calc(100% + 6px); right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); min-width: 170px; z-index: 200; padding: 4px 0; overflow: hidden; }",
    ".admin-dropdown-menu.open { display: block; }",
    ".dropdown-item { display: block; width: 100%; padding: .5rem 1rem; background: none; border: none; text-align: left; font-size: .78rem; font-family: inherit; color: var(--text); cursor: pointer; letter-spacing: .02em; text-decoration: none; }",
    ".dropdown-item:hover { background: var(--surface2); color: var(--gold-dark, var(--gold)); }",
    ".dropdown-caret { font-size: .65rem; margin-left: .3rem; opacity: .7; }",
    ".dropdown-item.sh-active { color: var(--gold); font-weight: 600; background: rgba(156,88,67,.10); }",
    ".dropdown-item.sh-active:hover { color: var(--gold-dark, var(--gold)); }"
  ].join("\n");

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildHtml(ctx) {
    var isAdmin = ctx === "admin";
    var title = "Gestão Gran SPA By L’Occitane";

    function item(id, label, href) {
      if (isAdmin) {
        return "<button class=\"dropdown-item\" id=\"" + id + "\">" + label + "</button>";
      }
      return "<a href=\"" + (href || "/admin") + "\" class=\"dropdown-item\">" + label + "</a>";
    }

    var escalaItem = isAdmin
      ? "<a href=\"/escala-spa.html\" class=\"dropdown-item\" style=\"text-decoration:none;display:block\">Escala de Trabalho</a>"
      : "<a href=\"/escala-spa.html\" class=\"dropdown-item sh-active\">Escala de Trabalho</a>";

    var sunSvg = "<svg id=\"ic-sun\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"display:none\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg>";
    var moonSvg = "<svg id=\"ic-moon\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"/></svg>";
    var homeSvg = "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px;margin-right:.25rem\"><path d=\"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><polyline points=\"9 22 9 12 15 12 15 22\"/></svg>";
    var sairSvg = "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px\"><path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/><polyline points=\"16 17 21 12 16 7\"/><line x1=\"21\" y1=\"12\" x2=\"9\" y2=\"12\"/></svg>";

    return (
      "<a class=\"header-brand\" id=\"sh-logo\" href=\"https://hub-granmarquise.fly.dev\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Abrir o Hub em nova aba\" style=\"text-decoration:none;color:inherit;cursor:pointer\">" +
        "<img class=\"brand-logo\" src=\"https://letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png\" alt=\"Gran Marquise\">" +
        "<span class=\"sep\"></span>" +
        "<small>" + title + "</small>" +
      "</a>" +
      "<div class=\"header-actions\">" +
        "<button class=\"btn btn-outline btn-sm\" id=\"btn-header-home\" title=\"Voltar para a página inicial\" style=\"display:none;border-color:var(--gold);color:var(--gold-dark);font-weight:600\">" +
          homeSvg + "Início" +
        "</button>" +
        "<div class=\"admin-dropdown\" id=\"spa-dropdown\">" +
          "<button class=\"btn btn-outline btn-sm\" id=\"btn-spa-toggle\">SPA<span class=\"dropdown-caret\">▾</span></button>" +
          "<div class=\"admin-dropdown-menu\" id=\"spa-dropdown-menu\">" +
            item("btn-open-massagistas", "Profissionais") +
            item("btn-open-tipos", "Tratamentos") +
            escalaItem +
          "</div>" +
        "</div>" +
        "<div class=\"admin-dropdown\" id=\"admin-dropdown\">" +
          "<button class=\"btn btn-outline btn-sm\" id=\"btn-admin-toggle\">Administrativo<span class=\"dropdown-caret\">▾</span></button>" +
          "<div class=\"admin-dropdown-menu\" id=\"admin-dropdown-menu\">" +
            item("btn-open-relatorios", "Relatórios") +
            item("btn-open-qualidade", "Gestão da Qualidade") +
            item("btn-open-anamnese-editor", "Editor de Anamnese") +
            item("btn-open-pesquisa-editor", "Editor da Pesquisa de Satisfação") +
            item("btn-open-clientes", "Clientes 360") +
            item("btn-open-usuarios", "Usuários") +
          "</div>" +
        "</div>" +
        "<span id=\"gm-datahora\" class=\"gm-datahora\" title=\"Horário de Fortaleza\" style=\"margin-left:.5rem;font-family:ui-monospace,'JetBrains Mono',Menlo,monospace;font-size:.75rem;letter-spacing:.04em;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:500\">--/--/---- · --:--</span>" +
        "<button class=\"btn btn-outline btn-sm\" id=\"btn-theme\" title=\"Alternar modo claro/escuro\" aria-label=\"Alternar modo claro/escuro\" style=\"margin-left:.25rem;padding:.3rem .5rem;display:inline-flex;align-items:center;justify-content:center;line-height:1\">" +
          sunSvg + moonSvg +
        "</button>" +
        "<button class=\"btn btn-outline btn-sm\" id=\"btn-sair-hub\" title=\"Sair e voltar ao Hub\" style=\"margin-left:.5rem;display:inline-flex;align-items:center;gap:6px\">" +
          sairSvg + "Sair" +
        "</button>" +
      "</div>"
    );
  }

  function setupTheme() {
    var btn    = document.getElementById("btn-theme");
    var icSun  = document.getElementById("ic-sun");
    var icMoon = document.getElementById("ic-moon");
    function aplicarVisual() {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (icSun)  icSun.style.display  = dark ? "" : "none";
      if (icMoon) icMoon.style.display = dark ? "none" : "";
    }
    aplicarVisual();
    if (!btn) return;
    btn.addEventListener("click", function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (dark) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", "dark");
      try { localStorage.setItem("spa_theme", dark ? "light" : "dark"); } catch (_) {}
      aplicarVisual();
    });
  }

  function setupSair() {
    var btn = document.getElementById("btn-sair-hub");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var t = "light";
      try { t = localStorage.getItem("spa_theme") === "dark" ? "dark" : "light"; } catch (_) {}
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
      try { fetch("/api/admin/logout", { method: "POST", credentials: "include", keepalive: true }).catch(function(){}); } catch (_) {}
      window.location.href = "https://hub-granmarquise.fly.dev/?logout=1&from=pesquisa&theme=" + t;
    });
  }

  function setupLogoLink() {
    var logo = document.getElementById("sh-logo");
    if (!logo) return;
    logo.addEventListener("click", function () {
      var t = "light";
      try { t = localStorage.getItem("spa_theme") === "dark" ? "dark" : "light"; } catch (_) {}
      logo.setAttribute("href", "https://hub-granmarquise.fly.dev/?theme=" + t);
    });
  }

  function setupClock() {
    var el = document.getElementById("gm-datahora");
    if (!el) return;
    function tick() {
      var d    = new Date();
      var data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
      var hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }).format(d);
      el.textContent = data + " · " + hora;
    }
    tick();
    setInterval(tick, 30000);
  }

  function setupDropdownToggles() {
    var allMenuIds = ["spa-dropdown-menu", "admin-dropdown-menu"];
    function closeAll() {
      allMenuIds.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove("open");
      });
    }
    function makeDropdown(toggleId, menuId) {
      var toggle = document.getElementById(toggleId);
      var menu   = document.getElementById(menuId);
      if (!toggle || !menu) return;
      if (toggle.dataset.ddBound) return;
      toggle.dataset.ddBound = "1";
      toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = menu.classList.contains("open");
        closeAll();
        if (!wasOpen) menu.classList.add("open");
      });
      menu.addEventListener("click", function () { menu.classList.remove("open"); });
    }
    makeDropdown("btn-spa-toggle",   "spa-dropdown-menu");
    makeDropdown("btn-admin-toggle", "admin-dropdown-menu");
    document.addEventListener("click", function () { closeAll(); });
  }

  window.initSharedHeader = function initSharedHeader(opts) {
    opts = opts || {};
    var ctx     = opts.context || "admin";
    var isAdmin = ctx === "admin";
    var anchor  = document.currentScript;

    injectCss();

    var header = document.createElement("header");
    if (!isAdmin) header.classList.add("sh-ctx-escala");
    header.innerHTML = buildHtml(ctx);

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(header, anchor);
    } else {
      var ref = document.getElementById("app-screen") || document.body;
      ref.insertBefore(header, ref.firstChild);
    }

    setupTheme();
    setupSair();
    setupLogoLink();
    setupClock();
    setupDropdownToggles();

    if (!isAdmin) {
      var homeBtn = document.getElementById("btn-header-home");
      if (homeBtn) {
        homeBtn.style.display = "";
        homeBtn.addEventListener("click", function () {
          window.location.href = "/admin";
        });
      }
    }
  };
})();
