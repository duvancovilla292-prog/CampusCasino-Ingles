/* =========================================================================
   CASINO CAMPUS — THEME: "Day / Morning after" and "Night / Casino"
   Loaded synchronously in <head> (before the body is parsed) so the saved theme
   is on <html data-theme="..."> before the first paint: no flash of the wrong theme.
   - Builds every [data-theme-switch] host into a two-option radio group.
   - Keeps all switches in sync, persists the choice in localStorage and follows
     changes made in other tabs/windows through the `storage` event.
   - Animates the change with the View Transitions API (cross-fade), or with a short
     colour curtain where that API is missing; instant under prefers-reduced-motion.
   All visual rules live in CSS/theme.css; this file only switches the attribute.
   ========================================================================= */
"use strict";

const Theme = (() => {
    const KEY = "casinoCampus.theme.v1";
    const DEFAULT = "night";
    const root = document.documentElement;
    const OPTIONS = [
        { id: "day", icon: "☀️", label: "Modo Día — Mañana", short: "Día", color: "#ece5d8" },
        { id: "night", icon: "\u{1F319}", label: "Modo Noche — Casino", short: "Noche", color: "#05060d" }
    ];
    const valid = (t) => OPTIONS.some((o) => o.id === t);
    const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function read() {
        try {
            const t = window.localStorage.getItem(KEY);
            return valid(t) ? t : DEFAULT;
        } catch (err) {
            return DEFAULT; // storage blocked (private mode): fall back to the default theme
        }
    }

    function save(t) {
        try { window.localStorage.setItem(KEY, t); } catch (err) { /* not persisted, still applied */ }
    }

    /** Applies the theme to the document and reflects it on every switch. */
    function paint(t) {
        root.setAttribute("data-theme", t);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", OPTIONS.find((o) => o.id === t).color);
        document.querySelectorAll("[data-theme-switch] [data-theme-set]").forEach((b) => {
            const on = b.getAttribute("data-theme-set") === t;
            b.setAttribute("aria-checked", on ? "true" : "false");
            b.tabIndex = on ? 0 : -1;
        });
    }

    function set(t, opts) {
        const { persist = true, animate = true } = opts || {};
        if (!valid(t)) return;
        if (persist) save(t);
        if (t === root.getAttribute("data-theme")) return paint(t);
        if (!animate || reducedMotion() || !document.body) return paint(t);
        if (typeof document.startViewTransition === "function") {
            document.startViewTransition(() => paint(t));
            return;
        }
        // Fallback: a soft colour curtain covers the swap, so nothing flickers.
        const curtain = document.createElement("div");
        curtain.className = "theme-curtain";
        curtain.setAttribute("data-to", t);
        curtain.setAttribute("aria-hidden", "true");
        document.body.appendChild(curtain);
        window.requestAnimationFrame(() => {
            curtain.classList.add("is-in");
            window.setTimeout(() => {
                paint(t);
                curtain.classList.remove("is-in");
                window.setTimeout(() => curtain.remove(), 360);
            }, 200);
        });
    }

    /** Turns an empty host element into the accessible two-option switch. */
    function build(host) {
        if (host.querySelector("[data-theme-set]")) return;
        host.classList.add("theme-switch");
        host.setAttribute("role", "radiogroup");
        host.setAttribute("aria-label", "Ambiente del casino");
        OPTIONS.forEach((o) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "theme-switch-opt";
            b.setAttribute("role", "radio");
            b.setAttribute("data-theme-set", o.id);
            b.setAttribute("aria-label", o.label);
            b.title = o.label;
            const ic = document.createElement("span");
            ic.className = "theme-switch-ic";
            ic.setAttribute("aria-hidden", "true");
            ic.textContent = o.icon;
            const long = document.createElement("span");
            long.className = "theme-switch-txt";
            long.setAttribute("aria-hidden", "true");
            long.textContent = o.label;
            const short = document.createElement("span");
            short.className = "theme-switch-short";
            short.setAttribute("aria-hidden", "true");
            short.textContent = o.short;
            b.append(ic, long, short);
            b.addEventListener("click", () => set(o.id));
            host.appendChild(b);
        });
        // Radio-group keyboard pattern: arrows (and Home/End) move and select.
        host.addEventListener("keydown", (e) => {
            const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            let next = null;
            const i = OPTIONS.findIndex((o) => o.id === root.getAttribute("data-theme"));
            if (e.key in keys) next = OPTIONS[(i + keys[e.key] + OPTIONS.length) % OPTIONS.length].id;
            else if (e.key === "Home") next = OPTIONS[0].id;
            else if (e.key === "End") next = OPTIONS[OPTIONS.length - 1].id;
            if (!next) return;
            e.preventDefault();
            set(next);
            const target = host.querySelector(`[data-theme-set="${next}"]`);
            if (target) target.focus();
        });
    }

    function mount() {
        document.querySelectorAll("[data-theme-switch]").forEach(build);
        paint(root.getAttribute("data-theme") || read());
    }

    // 1) Before first paint.
    paint(read());
    // 2) Once the markup exists.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
    // 3) Another tab or window changed the theme.
    window.addEventListener("storage", (e) => {
        if (e.key === KEY) set(valid(e.newValue) ? e.newValue : DEFAULT, { persist: false });
    });

    return {
        get: () => root.getAttribute("data-theme"),
        set,
        toggle: () => set(root.getAttribute("data-theme") === "day" ? "night" : "day")
    };
})();
