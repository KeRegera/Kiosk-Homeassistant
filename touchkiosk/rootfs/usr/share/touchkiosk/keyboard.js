// Touch Kiosk – Bildschirmtastatur
//
// Content-Script im Kiosk-Browser. Sobald ein Textfeld den Fokus bekommt
// (Anmeldeseite, Suchfelder, Dialoge …), erscheint die Tastatur am unteren
// Bildschirmrand – oder oben, falls sie das Feld verdecken würde.
// Mit der Taste "⌨ ▾" wird sie ausgeblendet; erneutes Antippen des Feldes
// holt sie zurück. touchkiosk-run hängt beim Start den Aufruf
// touchKioskKeyboard({layout: "de" | "en"}) an.

function touchKioskKeyboard(config) {
  "use strict";
  if (window.__touchKioskKeyboard) {
    return;
  }
  window.__touchKioskKeyboard = true;

  // --------------------------------------------------------------- Layouts
  const SHIFT = (w) => ({ k: "shift", w, label: "⇧" });
  const BACK = (w) => ({ k: "back", w, label: "⌫" });
  const ENTER = (w) => ({ k: "enter", w, label: "↵" });
  const LAYER = (w, label) => ({ k: "layer", w, label });
  const SPACE = (w, label) => ({ k: "space", w, label });
  const HIDE = (w) => ({ k: "hide", w, label: "⌨ ▾" });
  const LEFT = (w) => ({ k: "left", w, label: "←" });
  const RIGHT = (w) => ({ k: "right", w, label: "→" });
  const chars = (s) => Array.from(s);

  const LAYOUTS = {
    de: {
      letters: [
        chars("1234567890ß"),
        chars("qwertzuiopü"),
        chars("asdfghjklöä"),
        [SHIFT(1.5), ...chars("yxcvbnm-"), BACK(1.5)],
        [LAYER(1.5, "?123"), "@", ",", SPACE(4, "Leerzeichen"), ".", ENTER(1.5), HIDE(1)],
      ],
      symbols: [
        chars("1234567890?"),
        chars('!"§$%&/()=€'),
        chars("+*#'_:;<>|~"),
        [LEFT(1), RIGHT(1), ...chars("\\[]{}^°"), BACK(2)],
        [LAYER(1.5, "ABC"), "@", ",", SPACE(4, "Leerzeichen"), ".", ENTER(1.5), HIDE(1)],
      ],
    },
    en: {
      letters: [
        chars("1234567890"),
        chars("qwertyuiop"),
        chars("asdfghjkl"),
        [SHIFT(1.5), ...chars("zxcvbnm"), BACK(1.5)],
        [LAYER(1.5, "?123"), "@", SPACE(3, "space"), ",", ".", ENTER(1.5), HIDE(1)],
      ],
      symbols: [
        chars("!@#$%^&*()"),
        chars("-_=+[]{}\\|"),
        chars(";:'\"<>?/`~"),
        [LEFT(1), RIGHT(1), ...chars("€£§°"), BACK(2)],
        [LAYER(1.5, "ABC"), "@", SPACE(3, "space"), ",", ".", ENTER(1.5), HIDE(1)],
      ],
    },
  };
  const layout = LAYOUTS[config && config.layout] || LAYOUTS.de;

  // Breite einer Zeile in halben Tasten, damit alle Zeilen gleich ausgerichtet sind
  const keyWidth = (key) => (typeof key === "string" ? 1 : key.w);
  const rowWidth = (row) => row.reduce((sum, key) => sum + keyWidth(key), 0);
  const COLUMNS = Math.round(
    2 * Math.max(...[...layout.letters, ...layout.symbols].map(rowWidth)),
  );

  const TEXT_TYPES = new Set(["", "text", "password", "email", "search", "url", "tel", "number"]);

  // ----------------------------------------------------------------- State
  let host = null;
  let board = null;
  let layer = "letters";
  let shift = 0; // 0 = aus, 1 = einmal, 2 = feststellen
  let lastShiftTap = 0;
  let visible = false;
  let target = null;
  let dismissedFor = null;
  let repeatTimer = null;
  let repeatInterval = null;
  let pressedKey = null;
  let deferredKey = null;
  let renderedLayer = null;
  let guardUntil = 0;
  let guardRect = null;
  // Wert beim Fokussieren – Enter löst wie im Browser "change" aus, wenn er sich geändert hat
  const committed = new WeakMap();
  const hasPopover = typeof HTMLElement.prototype.showPopover === "function";

  // ------------------------------------------------------- DOM-Hilfsmittel
  function composedParent(node) {
    if (!node) return null;
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentNode) {
      return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
    }
    return node instanceof ShadowRoot ? node.host : null;
  }

  function composedContains(ancestor, node) {
    for (let n = node; n; n = composedParent(n)) {
      if (n === ancestor) return true;
    }
    return false;
  }

  function deepActive() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function isEditable(el) {
    if (!el || !(el instanceof HTMLElement) || el.disabled || el.readOnly) return false;
    if (el.inputMode === "none") return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) return TEXT_TYPES.has((el.getAttribute("type") || "").toLowerCase());
    return el.isContentEditable;
  }

  function isOwn(node) {
    return host !== null && composedContains(host, node);
  }

  // Tastatur muss in einem offenen modalen Dialog bzw. Popover liegen,
  // sonst ist sie dort "inert" (nicht antippbar) oder schließt das Popover.
  function containerFor(el) {
    for (let n = composedParent(el); n; n = composedParent(n)) {
      if (n instanceof HTMLDialogElement && n.open) {
        return n;
      }
      if (n instanceof HTMLElement && n.hasAttribute("popover")) {
        let open = false;
        try {
          open = n.matches(":popover-open");
        } catch (_err) {
          open = false;
        }
        if (open) return n.shadowRoot || n;
      }
    }
    return document.body || document.documentElement;
  }

  // ------------------------------------------------------------- Aufbau
  const CSS = `
    .kb {
      box-sizing: border-box;
      width: 100%;
      padding: 8px 8px 10px;
      background: #1b1b1f;
      box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.35);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      font-family: "DejaVu Sans", "Noto Sans", sans-serif;
      --kh: clamp(38px, 6.2vh, 74px);
      --fs: clamp(16px, 2.8vh, 30px);
    }
    .kb.top { box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35); }
    .inner {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(${COLUMNS}, minmax(0, 1fr));
      gap: 8px;
    }
    .key {
      height: var(--kh);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 9px;
      background: #3b3b42;
      color: #fff;
      font-size: var(--fs);
      line-height: 1;
      box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
      overflow: hidden;
      white-space: nowrap;
    }
    .key.special { background: #2a2a30; font-size: calc(var(--fs) * 0.8); }
    .key.space { color: #9a9aa3; font-size: calc(var(--fs) * 0.6); }
    .key.enter, .key.on { background: #03a9f4; }
    .key.locked { background: #0277bd; text-decoration: underline; }
    .key.down { background: #6c6c75; transform: translateY(1px); box-shadow: none; }
    .key.enter.down, .key.on.down { background: #4fc3f7; }
  `;

  function setImportant(el, styles) {
    for (const [prop, value] of Object.entries(styles)) {
      el.style.setProperty(prop, value, "important");
    }
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.id = "touchkiosk-keyboard";
    if (hasPopover) host.setAttribute("popover", "manual");
    setImportant(host, {
      position: "fixed",
      left: "0",
      right: "0",
      top: "auto",
      bottom: "0",
      width: "100%",
      "max-width": "none",
      height: "auto",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      overflow: "visible",
      "z-index": "2147483647",
      "box-sizing": "border-box",
    });
    if (!hasPopover) host.style.setProperty("display", "none", "important");

    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    board = document.createElement("div");
    board.className = "kb";
    root.append(style, board);

    // Fokus im Textfeld lassen, nichts an die Seite durchreichen
    const swallow = (ev) => {
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
    };
    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointerup", onPointerUp);
    board.addEventListener("pointercancel", () => {
      deferredKey = null;
      stopRepeat();
    });
    board.addEventListener("pointerleave", stopRepeat);
    for (const type of ["mousedown", "touchstart", "contextmenu"]) {
      board.addEventListener(type, swallow, { passive: false });
    }
    for (const type of ["mouseup", "touchend", "click", "dblclick"]) {
      board.addEventListener(type, (ev) => ev.stopPropagation());
    }
  }

  function render() {
    const rows = layout[layer];
    const inner = document.createElement("div");
    inner.className = "inner";

    rows.forEach((row, r) => {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      // Kürzere Zeilen mittig ausrichten
      const lead = Math.floor((COLUMNS - Math.round(rowWidth(row) * 2)) / 2);
      if (lead > 0) {
        const spacer = document.createElement("span");
        spacer.style.gridColumn = `span ${lead}`;
        rowEl.append(spacer);
      }
      row.forEach((key, c) => {
        const el = document.createElement("div");
        el.className = "key";
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.style.gridColumn = `span ${Math.round(keyWidth(key) * 2)}`;
        if (typeof key === "string") {
          el.textContent = applyShift(key);
        } else {
          el.textContent = key.label;
          el.classList.add("special", key.k);
          if (key.k === "shift" && shift > 0) el.classList.add("on");
          if (key.k === "shift" && shift === 2) el.classList.add("locked");
        }
        rowEl.append(el);
      });
      inner.append(rowEl);
    });

    board.replaceChildren(inner);
    renderedLayer = layer;
  }

  // Beschriftung/Zustand aktualisieren, ohne die Tasten neu zu erzeugen
  // (die gerade berührte Taste muss bis zum Loslassen erhalten bleiben).
  function refresh() {
    if (renderedLayer !== layer || !board.firstChild) {
      render();
      return;
    }
    for (const el of board.querySelectorAll(".key")) {
      const key = keyAt(el);
      if (typeof key === "string") {
        el.textContent = applyShift(key);
      } else if (key && key.k === "shift") {
        el.classList.toggle("on", shift > 0);
        el.classList.toggle("locked", shift === 2);
      }
    }
  }

  function applyShift(ch) {
    if (shift === 0 || ch === "ß") return ch;
    return ch.toUpperCase();
  }

  // ------------------------------------------------------- Anzeigen/Weg
  function show(el) {
    ensureHost();
    const changedTarget = el !== target;
    target = el;
    if (changedTarget) {
      layer = "letters";
      shift = 0;
      render();
    } else {
      refresh();
    }

    const container = containerFor(el);
    if (host.parentNode !== container) {
      hideHost();
      container.appendChild(host);
    } else if (changedTarget && visible) {
      hideHost(); // erneut zeigen -> liegt wieder ganz oben
    }
    showHost();
    visible = true;
    place(el);
  }

  function showHost() {
    if (hasPopover) {
      try {
        if (!host.matches(":popover-open")) host.showPopover();
      } catch (_err) {
        host.style.setProperty("display", "block", "important");
      }
    } else {
      host.style.setProperty("display", "block", "important");
    }
  }

  function hideHost() {
    if (!host) return;
    if (hasPopover) {
      try {
        if (host.matches(":popover-open")) host.hidePopover();
      } catch (_err) {
        /* bereits geschlossen */
      }
      host.style.removeProperty("display");
    } else {
      host.style.setProperty("display", "none", "important");
    }
  }

  function hide() {
    stopRepeat();
    hideHost();
    visible = false;
  }

  function dock(top) {
    setImportant(host, top ? { top: "0", bottom: "auto" } : { top: "auto", bottom: "0" });
    board.classList.toggle("top", top);
  }

  function place(el) {
    dock(false);
    const height = board.getBoundingClientRect().height;
    const limit = window.innerHeight - height - 8;
    let rect = el.getBoundingClientRect();
    if (rect.bottom <= limit) return;
    if (rect.top >= height + 8) {
      dock(true);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    rect = el.getBoundingClientRect();
    if (rect.bottom > limit && rect.top >= height + 8) dock(true);
  }

  // ------------------------------------------------------------ Eingabe
  function activeField() {
    const el = deepActive();
    if (isEditable(el)) return el;
    if (target && target.isConnected && isEditable(target)) {
      target.focus({ preventScroll: true });
      return target;
    }
    return null;
  }

  function fire(el, inputType, data) {
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true, inputType, data }),
    );
  }

  function insertText(text) {
    const el = activeField();
    if (!el) return;
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_err) {
      ok = false;
    }
    if (ok || el.isContentEditable) return;
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || start === undefined) throw new Error("keine Auswahl");
      el.setRangeText(text, start, end, "end");
    } catch (_err) {
      el.value += text;
    }
    fire(el, "insertText", text);
  }

  function backspace() {
    const el = activeField();
    if (!el) return;
    let ok = false;
    try {
      ok = document.execCommand("delete", false);
    } catch (_err) {
      ok = false;
    }
    if (ok || el.isContentEditable) return;
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || start === undefined) throw new Error("keine Auswahl");
      if (start === end && start > 0) el.setRangeText("", start - 1, end, "end");
      else if (start !== end) el.setRangeText("", start, end, "end");
      else return;
    } catch (_err) {
      el.value = el.value.slice(0, -1);
    }
    fire(el, "deleteContentBackward", null);
  }

  function moveCaret(delta) {
    const el = activeField();
    if (!el) return;
    if (el.isContentEditable) {
      const sel = el.getRootNode().getSelection ? el.getRootNode().getSelection() : window.getSelection();
      if (sel && sel.modify) sel.modify("move", delta < 0 ? "backward" : "forward", "character");
      return;
    }
    try {
      const pos = delta < 0 ? el.selectionStart : el.selectionEnd;
      const next = Math.max(0, Math.min(el.value.length, pos + delta));
      el.setSelectionRange(next, next);
    } catch (_err) {
      /* Feldtyp ohne Cursor (z. B. email) */
    }
  }

  function enter() {
    const el = activeField();
    if (!el) return;
    if (el instanceof HTMLTextAreaElement || el.isContentEditable) {
      insertText("\n");
      return;
    }
    const init = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    // Wie ein echter Browser: Formular nur absenden, wenn die Seite Enter
    // weder bei keydown noch bei keypress selbst behandelt hat.
    const downOk = el.dispatchEvent(new KeyboardEvent("keydown", init));
    const pressOk = downOk ? el.dispatchEvent(new KeyboardEvent("keypress", init)) : false;
    if (pressOk && "value" in el && committed.has(el) && committed.get(el) !== el.value) {
      committed.set(el, el.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    if (downOk && pressOk && el.form && typeof el.form.requestSubmit === "function") {
      try {
        el.form.requestSubmit();
      } catch (_err) {
        /* Formular ohne Absenden-Schaltfläche */
      }
    }
  }

  function press(key) {
    if (typeof key === "string") {
      insertText(applyShift(key));
      if (shift === 1) {
        shift = 0;
        refresh();
      }
      return;
    }
    switch (key.k) {
      case "back":
        backspace();
        break;
      case "space":
        insertText(" ");
        break;
      case "enter":
        enter();
        break;
      case "left":
        moveCaret(-1);
        break;
      case "right":
        moveCaret(1);
        break;
      case "shift": {
        const now = Date.now();
        if (shift === 0) shift = now - lastShiftTap < 400 ? 2 : 1;
        else if (shift === 1) shift = now - lastShiftTap < 400 ? 2 : 0;
        else shift = 0;
        lastShiftTap = now;
        refresh();
        break;
      }
      case "layer":
        layer = layer === "letters" ? "symbols" : "letters";
        shift = 0;
        render();
        break;
      case "hide":
        dismissedFor = target;
        hide();
        break;
      default:
        break;
    }
  }

  function keyAt(el) {
    if (!el || !el.dataset || el.dataset.r === undefined) return null;
    const row = layout[layer][Number(el.dataset.r)];
    return row ? row[Number(el.dataset.c)] : null;
  }

  function onPointerDown(ev) {
    ev.stopPropagation();
    if (ev.cancelable) ev.preventDefault();
    const keyEl = ev.target instanceof Element ? ev.target.closest(".key") : null;
    const key = keyAt(keyEl);
    if (!key) return;

    stopRepeat();
    pressedKey = keyEl;
    keyEl.classList.add("down");
    guardRect = board.getBoundingClientRect();
    guardUntil = Date.now() + 800;

    // Ebene wechseln und Ausblenden erst beim Loslassen: Die Tasten bzw. die
    // ganze Tastatur verschwinden sonst mitten im Antippen, und der Rest der
    // Berührung landet auf der Seite darunter.
    if (typeof key !== "string" && (key.k === "layer" || key.k === "hide")) {
      deferredKey = key;
      return;
    }
    press(key);

    // Gedrückt halten wiederholt Löschen, Pfeile und Leerzeichen
    if (typeof key !== "string" && ["back", "left", "right", "space"].includes(key.k)) {
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => press(key), 70);
      }, 450);
    }
  }

  function onPointerUp(ev) {
    ev.stopPropagation();
    stopRepeat();
    guardUntil = Date.now() + 500;
    if (deferredKey) {
      const key = deferredKey;
      deferredKey = null;
      setTimeout(() => press(key), 0);
    }
  }

  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
    repeatTimer = null;
    repeatInterval = null;
    if (pressedKey) {
      // Kurz sichtbar lassen, dann Markierung entfernen
      const el = pressedKey;
      pressedKey = null;
      setTimeout(() => el.classList.remove("down"), 60);
    }
  }

  // Sicherheitsnetz: Klicks, die von einem Tastendruck stammen, aber auf der
  // Seite landen (z. B. weil die Tastatur gerade ausgeblendet wurde), abfangen.
  const guard = (ev) => {
    if (!guardRect || Date.now() > guardUntil) return;
    const path = ev.composedPath();
    if (path.length && isOwn(path[0])) return;
    const r = guardRect;
    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
      ev.stopImmediatePropagation();
      if (ev.cancelable) ev.preventDefault();
    }
  };
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]) {
    window.addEventListener(type, guard, true);
  }

  // ------------------------------------------------------------ Fokus
  document.addEventListener(
    "focusin",
    (ev) => {
      const el = ev.composedPath()[0];
      if (isOwn(el) || !isEditable(el)) return;
      if ("value" in el) committed.set(el, el.value);
      if (el === dismissedFor) {
        target = el;
        return;
      }
      dismissedFor = null;
      show(el);
    },
    true,
  );

  document.addEventListener(
    "focusout",
    () => {
      setTimeout(() => {
        const active = deepActive();
        if (!isEditable(active)) {
          hide();
          dismissedFor = null;
          target = null;
        }
      }, 60);
    },
    true,
  );

  // Erneutes Antippen eines Feldes holt die ausgeblendete Tastatur zurück
  document.addEventListener(
    "pointerdown",
    (ev) => {
      const path = ev.composedPath();
      if (path.length && isOwn(path[0])) return;
      setTimeout(() => {
        const active = deepActive();
        if (!isEditable(active) || (visible && active === target)) return;
        const hit = path.some(
          (n) =>
            n === active ||
            (n instanceof HTMLElement &&
              n !== document.body &&
              n !== document.documentElement &&
              composedContains(n, active) &&
              n.getBoundingClientRect().height < 220),
        );
        if (hit) {
          dismissedFor = null;
          show(active);
        }
      }, 80);
    },
    true,
  );

  window.addEventListener("resize", () => {
    if (visible && target && target.isConnected) place(target);
  });
}
