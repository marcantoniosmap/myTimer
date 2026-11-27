/* Big Two practice coach: screens and game flow. Game rules live in engine.js. */
(function () {
  "use strict";
  var B = window.BigTwo;
  var $ = function (id) { return document.getElementById(id); };
  var GAME_KEY = "bigtwo-coach-game", SETUP_KEY = "bigtwo-coach-setup", HISTORY_KEY = "bigtwo-coach-history";
  var BOT_NAMES = ["Hendra", "Budi", "Anton"];

  var setup = loadJSON(SETUP_KEY) || {
    mode: "practice", n: 4, names: ["You", "Hendra", "Budi", "Anton"], me: 0,
    rules: Object.assign({}, B.DEFAULT_RULES), showCoach: true, challenge: false
  };
  setup.rules = Object.assign({}, B.DEFAULT_RULES, setup.rules || {});
  if (!setup.rv || setup.rv < 2) { setup.rules.passLocksOut = true; setup.rv = 2; }
  var G = null;          // the game being played (saved on every change)
  var st = null;         // its current position, rebuilt from G.log
  var rules = null;
  var selected = new Set(), oppSel = new Set(), entrySel = new Set(), leadChoice = null;
  var coach = { at: -1, list: [], best: null, pending: false };
  var worker = null, simSeq = 0, botTimer = null, shadowRunning = false;
  var view = { trick: [], lastTrick: [], passedNow: new Set() };  // what is on the table right now

  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function show(view) { ["vHome", "vEntry", "vPlay", "vEnd"].forEach(function (v) { $(v).hidden = v !== view; }); window.scrollTo(0, 0); }
  function nameOf(i) { return G.names[i] + (i === G.me && G.names[i].toLowerCase() !== "you" ? " (you)" : ""); }
  function fmt(v) { v = Math.round(v * 10) / 10; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v); }

  function cardEl(c, opts) {
    opts = opts || {};
    var b = el("button", "pc" + (B.isRed(c) ? " red" : "") + (opts.small ? " small" : ""));
    b.type = "button";
    b.setAttribute("aria-label", B.RANKS[B.rankOf(c)] + " of " + B.SUIT_WORDS[B.suitOf(c)]);
    b.appendChild(el("span", "r", B.RANKS[B.rankOf(c)]));
    b.appendChild(el("span", "s", B.SUITS[B.suitOf(c)]));
    if (opts.onTap) b.addEventListener("click", function () { opts.onTap(c); }); else b.disabled = true;
    return b;
  }
  // 4 × 13 grid: rows ♠ ♥ ♣ ♦, columns 3 … 2
  function buildGrid(box, state) {
    box.textContent = "";
    for (var s = 3; s >= 0; s--) for (var r = 0; r < 13; r++) {
      var c = r * 4 + s, info = state(c);
      var b = cardEl(c, { onTap: info.disabled ? null : info.onTap });
      if (info.selected) b.classList.add("sel");
      if (info.gone) b.classList.add("gone");
      if (info.mine) b.classList.add("mine");
      box.appendChild(b);
    }
  }

  // ================= setup screen =================
  function renderHome() {
    document.querySelectorAll(".mode").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === setup.mode)); });
    document.querySelectorAll("#segPlayers button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.n === setup.n)); });
    $("seatHint").textContent = setup.mode === "practice"
      ? "You sit in seat 1; the bots play in the other seats."
      : "In seating order, going round the table. Mark which seat is you.";
    var box = $("names"); box.textContent = "";
    for (var i = 0; i < setup.n; i++) {
      if (setup.names[i] == null) setup.names[i] = i === 0 ? "You" : BOT_NAMES[(i - 1) % 3];
      var row = el("div", "name-row");
      row.appendChild(el("span", "seat-no", String(i + 1)));
      var inp = el("input"); inp.type = "text"; inp.value = setup.names[i]; inp.dataset.i = i;
      inp.setAttribute("aria-label", "Seat " + (i + 1) + " name");
      inp.addEventListener("input", function (e) { setup.names[+e.target.dataset.i] = e.target.value; });
      row.appendChild(inp);
      if (setup.mode === "track") {
        var lab = el("label"), rad = el("input");
        rad.type = "radio"; rad.name = "me"; rad.checked = setup.me === i; rad.dataset.i = i;
        rad.addEventListener("change", function (e) { setup.me = +e.target.dataset.i; });
        lab.appendChild(rad); lab.appendChild(document.createTextNode("me"));
        row.appendChild(lab);
      } else if (i === 0) {
        row.appendChild(el("label", null, "you"));
      } else {
        row.appendChild(el("label", null, "bot"));
      }
      box.appendChild(row);
    }
    if (setup.mode === "practice") setup.me = 0;
    if (setup.me >= setup.n) setup.me = 0;
    $("challengeRow").hidden = setup.mode !== "practice";
    $("optChallenge").checked = setup.mode === "practice" && !!setup.challenge;
    $("optCoach").checked = setup.showCoach && !$("optChallenge").checked;
    $("coachRow").hidden = $("optChallenge").checked;
    document.querySelectorAll("[data-rule]").forEach(function (cb) { cb.checked = !!setup.rules[cb.dataset.rule]; });
    var saved = loadJSON(GAME_KEY);
    $("resumeBox").hidden = !(saved && !saved.done && saved.log);
    if (saved && !saved.done) {
      $("resumeText").textContent = "Unfinished game: " + (saved.mode === "practice" ? "practice" : "real table") + " with " +
        saved.names.join(", ") + " — " + saved.log.length + " plays so far.";
    }
    renderHistory();
    $("btnUndo").hidden = $("btnLog").hidden = true;
    $("modeLabel").textContent = "";
    show("vHome");
  }

  document.querySelectorAll(".mode").forEach(function (b) {
    b.addEventListener("click", function () { setup.mode = b.dataset.mode; renderHome(); });
  });
  document.querySelectorAll("#segPlayers button").forEach(function (b) {
    b.addEventListener("click", function () { setup.n = +b.dataset.n; renderHome(); });
  });
  $("optCoach").addEventListener("change", function (e) { setup.showCoach = e.target.checked; });
  $("optChallenge").addEventListener("change", function (e) { setup.challenge = e.target.checked; renderHome(); });
  document.querySelectorAll("[data-rule]").forEach(function (cb) {
    cb.addEventListener("change", function () { setup.rules[cb.dataset.rule] = cb.checked; });
  });

  $("btnStart").addEventListener("click", function () {
    var names = setup.names.slice(0, setup.n).map(function (s) { return (s || "").trim(); });
    if (names.some(function (s) { return !s; })) { alert("Every seat needs a name."); return; }
    var lower = names.map(function (s) { return s.toLowerCase(); });
    if (lower.some(function (s, i) { return lower.indexOf(s) !== i; })) { alert("Every player needs a different name."); return; }
    setup.names = names.concat(setup.names.slice(setup.n));
    saveJSON(SETUP_KEY, setup);
    if (setup.mode === "practice") dealPractice(); else startEntry();
  });
  $("btnResume").addEventListener("click", function () { G = loadJSON(GAME_KEY); enterPlay(); });
  $("btnDiscard").addEventListener("click", function () { saveJSON(GAME_KEY, null); renderHome(); });

  // ================= new games =================
  function dealPractice() {
    var n = setup.n, deck = B.shuffle(Array.from({ length: 52 }, function (_, i) { return i; }), Math.random);
    var hands = [];
    for (var i = 0; i < n; i++) hands.push(B.sortCards(deck.slice(i * 13, i * 13 + 13)));
    var dead = deck.slice(n * 13);
    var startCard = B.startingCard(hands, dead);
    var challenge = !!setup.challenge;
    G = {
      v: 1, mode: "practice", n: n, names: setup.names.slice(0, n), me: 0, rules: Object.assign({}, setup.rules),
      showCoach: challenge ? false : setup.showCoach, challenge: challenge, shadow: null,
      seed: Math.floor(Math.random() * 2147483647), hands: hands, dead: dead,
      start: hands.findIndex(function (h) { return h.indexOf(startCard) >= 0; }),
      mustInclude: setup.rules.firstMustInclude ? startCard : null,
      log: [], review: [], done: false
    };
    enterPlay();
  }

  function startEntry() {
    entrySel = new Set(); leadChoice = null;
    renderEntry();
    show("vEntry");
  }
  function renderEntry() {
    buildGrid($("entryGrid"), function (c) {
      return { selected: entrySel.has(c), onTap: function (card) {
        if (entrySel.has(card)) entrySel.delete(card); else if (entrySel.size < 13) entrySel.add(card);
        renderEntry();
      } };
    });
    $("entryCount").textContent = entrySel.size + " of 13 selected";
    var needLead = entrySel.size === 13 && !entrySel.has(0);
    $("leadPick").hidden = !needLead;
    if (needLead) {
      var seg = $("segLead"); seg.textContent = "";
      setup.names.slice(0, setup.n).forEach(function (nm, i) {
        if (i === setup.me) return;
        var b = el("button", null, nm); b.type = "button";
        b.setAttribute("aria-pressed", String(leadChoice === i));
        b.addEventListener("click", function () { leadChoice = i; renderEntry(); });
        seg.appendChild(b);
      });
    }
    $("btnEntryOk").disabled = entrySel.size !== 13 || (needLead && leadChoice == null);
  }
  $("btnEntryBack").addEventListener("click", renderHome);
  $("btnEntryOk").addEventListener("click", function () {
    var mine = B.sortCards(Array.from(entrySel)), n = setup.n, me = setup.me;
    var holds3 = mine.indexOf(0) >= 0;
    var hands = []; for (var i = 0; i < n; i++) hands.push(i === me ? mine : null);
    G = {
      v: 1, mode: "track", n: n, names: setup.names.slice(0, n), me: me, rules: Object.assign({}, setup.rules),
      showCoach: setup.showCoach, hands: hands, dead: null,
      start: holds3 ? me : leadChoice,
      // with 4 players somebody surely holds the 3♦; with 2–3 it may be in the untouched pile
      mustInclude: setup.rules.firstMustInclude && (holds3 || n === 4) ? 0 : null,
      log: [], review: [], done: false
    };
    enterPlay();
  });

  // ================= playing =================
  function rebuild() {
    rules = B.makeRules(G.rules);
    st = B.newGame({ n: G.n, hands: G.hands, counts: G.hands.map(function () { return 13; }), start: G.start, mustInclude: G.mustInclude });
    var trick = [], lastTrick = [], trickStart = 0;
    G.log.forEach(function (e, idx) {
      B.applyMove(st, e.p, e.cards ? B.classify(e.cards, rules) : null, rules);
      if (e.cards) trick.push({ p: e.p, cards: e.cards });
      if (!st.over && !st.table && trick.length) { lastTrick = trick; trick = []; trickStart = idx + 1; }
    });
    var passedNow = new Set();
    for (var k = trickStart; k < G.log.length; k++) if (!G.log[k].cards) passedNow.add(G.log[k].p);
    view = { trick: trick, lastTrick: lastTrick, passedNow: passedNow };
  }
  function enterPlay() {
    selected.clear(); oppSel.clear();
    coach = { at: -1, list: [], best: null, pending: false };
    $("modeLabel").textContent = G.mode === "practice" ? (G.challenge ? "Challenge vs Coach" : "Practice") : "Real table";
    if (G.challenge && !G.shadow) startShadow();
    $("btnUndo").hidden = $("btnLog").hidden = false;
    show("vPlay");
    afterChange();
  }
  function afterChange() {
    saveJSON(GAME_KEY, G);
    rebuild();
    if (st.over) { finish(); return; }
    render();
    clearTimeout(botTimer);
    if (G.mode === "practice" && st.turn !== G.me) {
      botTimer = setTimeout(function () {
        var p = st.turn;
        record(p, B.botMove(st, p, rules, G.seed != null ? B.botRng(G.seed, G.log.length) : Math.random));
      }, 800);
    }
    if (st.turn === G.me && coach.at !== G.log.length) runCoach();
  }
  function record(p, cb) {
    var from = cb ? sourceRects(p, cb) : null;
    var hadTrick = view.trick.length > 0;
    var oldPile = $("pile").cloneNode(true);
    G.log.push({ p: p, cards: cb ? cb.cards.slice() : null });
    selected.clear(); oppSel.clear();
    $("playMsg").textContent = "";
    afterChange();
    if ($("vPlay").hidden) return;
    if (cb) animateLanding(cb, from);
    else {
      passBubble(p);
      if (hadTrick && !view.trick.length) sweep(oldPile);
    }
  }

  // ================= the table =================
  // seats go round the table clockwise from you (you are at the bottom)
  function seatPos(i) {
    var rel = (i - G.me + G.n) % G.n;
    if (G.n === 2) return "Top";
    if (G.n === 3) return rel === 1 ? "Left" : "Right";
    return ["", "Left", "Top", "Right"][rel];
  }
  var ARM_SVG = '<svg class="t-arm" viewBox="0 0 150 150" aria-hidden="true">' +
    '<defs><linearGradient id="slv" x1="0" x2="1"><stop offset="0" stop-color="#1F2833"/><stop offset=".5" stop-color="#34404F"/><stop offset="1" stop-color="#1F2833"/></linearGradient></defs>' +
    '<path d="M50 -4 H100 L94 92 H56 Z" fill="url(#slv)"/>' +
    '<rect x="55" y="88" width="40" height="11" rx="3" fill="#E9E4D8"/>' +
    '<ellipse cx="75" cy="112" rx="21" ry="16" fill="#C9946B" stroke="#9C6B47" stroke-width="1.2"/></svg>';
  var FINGERS_SVG = '<svg class="t-hand-front" viewBox="0 0 150 150" aria-hidden="true">' +
    '<ellipse cx="58" cy="116" rx="10" ry="6" transform="rotate(-35 58 116)" fill="#C9946B" stroke="#9C6B47" stroke-width="1.2"/>' +
    '<rect x="66" y="118" width="7" height="14" rx="3.5" fill="#C9946B" stroke="#9C6B47" stroke-width="1"/>' +
    '<rect x="73" y="119" width="7" height="15" rx="3.5" fill="#C9946B" stroke="#9C6B47" stroke-width="1"/>' +
    '<rect x="80" y="118" width="7" height="14" rx="3.5" fill="#C9946B" stroke="#9C6B47" stroke-width="1"/>' +
    '<rect x="87" y="116" width="6" height="12" rx="3" fill="#C9946B" stroke="#9C6B47" stroke-width="1"/></svg>';

  function renderSeats() {
    ["Top", "Left", "Right"].forEach(function (pos) { $("seat" + pos).hidden = true; });
    for (var i = 0; i < G.n; i++) {
      if (i === G.me) continue;
      var box = $("seat" + seatPos(i));
      box.hidden = false;
      var passed = st.table && view.passedNow.has(i);
      box.className = "t-seat pos-" + seatPos(i).toLowerCase() + (st.turn === i ? " turn" : "") +
        (passed && rules.passLocksOut ? " out" : "") + (st.counts[i] <= 2 ? " warn" : "");
      box.dataset.p = i;
      box.innerHTML = "";
      var holder = el("div", "t-holder");
      holder.innerHTML = ARM_SVG;
      var fan = el("div", "t-fan"), k = Math.min(st.counts[i], 13);
      var spread = Math.min(80, 7 * k);
      for (var j = 0; j < k; j++) {
        var back = el("div", "t-back");
        var ang = k === 1 ? 0 : -spread / 2 + j * spread / (k - 1);
        back.style.transform = "rotate(" + ang + "deg) translateY(-4px)";
        fan.appendChild(back);
      }
      holder.appendChild(fan);
      holder.insertAdjacentHTML("beforeend", FINGERS_SVG);
      box.appendChild(holder);
      var plate = el("div", "t-plate");
      plate.appendChild(el("div", "nm", G.names[i]));
      var ct = el("div", "ct"); ct.appendChild(el("b", null, String(st.counts[i]))); ct.appendChild(document.createTextNode(st.counts[i] === 1 ? " card" : " cards"));
      plate.appendChild(ct);
      if (st.turn === i) plate.appendChild(el("div", "st think", G.mode === "practice" ? "THINKING…" : "THEIR TURN"));
      else if (passed) plate.appendChild(el("div", "st pass", rules.passLocksOut ? "PASSED · OUT" : "PASS"));
      box.appendChild(plate);
    }
  }

  function playOffset(k) {
    return { dx: ((k * 53) % 46) - 23, dy: ((k * 29) % 30) - 15, rot: ((k * 37) % 17) - 8 };
  }
  function renderPile() {
    var pile = $("pile"); pile.textContent = "";
    view.trick.forEach(function (pl, k) {
      var o = playOffset(k), top = k === view.trick.length - 1;
      var d = el("div", "t-play " + (top ? "top" : "old"));
      if (!top) { d.style.setProperty("--dx", o.dx + "px"); d.style.setProperty("--dy", o.dy + "px"); d.style.setProperty("--rot", o.rot + "deg"); }
      pl.cards.forEach(function (c) { d.appendChild(cardEl(c)); });
      pile.appendChild(d);
    });
    var msg = $("tableMsg"); msg.textContent = "";
    if (view.trick.length) {
      var last = view.trick[view.trick.length - 1];
      msg.appendChild(el("b", null, G.names[last.p]));
      msg.appendChild(document.createTextNode(" · " + B.describe(B.classify(last.cards, rules))));
    } else {
      msg.appendChild(el("b", null, st.turn === G.me ? "You" : G.names[st.turn]));
      msg.appendChild(document.createTextNode(" lead" + (st.turn === G.me ? "" : "s") + " — any play" +
        (st.mustInclude != null ? ", must include the " + B.label(st.mustInclude) : "")));
    }
  }

  // where a play comes from (for the flying animation)
  function sourceRects(p, cb) {
    if (p === G.me) {
      return cb.cards.map(function (c) {
        var e = $("hand").querySelector('[data-c="' + c + '"]');
        return e ? e.getBoundingClientRect() : null;
      });
    }
    var seat = document.querySelector('.t-seat[data-p="' + p + '"] .t-holder');
    var r = seat ? seat.getBoundingClientRect() : null;
    return cb.cards.map(function () { return r; });
  }
  function animateLanding(cb, from) {
    var top = $("pile").lastElementChild;
    if (!top || typeof top.animate !== "function" || !from) return;
    var kids = Array.prototype.slice.call(top.children);
    kids.forEach(function (kid, i) {
      var f = from[i], t = kid.getBoundingClientRect();
      if (!f) return;
      var dx = (f.left + f.width / 2) - (t.left + t.width / 2), dy = (f.top + f.height / 2) - (t.top + t.height / 2);
      kid.animate([
        { transform: "translate(" + dx + "px," + dy + "px) rotate(" + (i % 2 ? 14 : -14) + "deg) scale(.85)", opacity: 0.4 },
        { transform: "none", opacity: 1 }
      ], { duration: 460, delay: i * 40, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" });
    });
  }
  function passBubble(p) {
    var anchor = p === G.me ? $("hand") : document.querySelector('.t-seat[data-p="' + p + '"]');
    if (!anchor || typeof anchor.animate !== "function") return;
    var stage = $("stage").getBoundingClientRect(), r = anchor.getBoundingClientRect();
    var b = el("div", "t-bubble", "PASS");
    b.style.left = (r.left + r.width / 2 - stage.left) + "px";
    b.style.top = Math.max(30, Math.min(stage.height - 30, r.top + r.height / 2 - stage.top)) + "px";
    $("stage").appendChild(b);
    b.animate([{ opacity: 0, transform: "translate(-50%,-50%) scale(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1.05)", offset: .3 }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: .8 }, { opacity: 0, transform: "translate(-50%,-50%) scale(1)" }],
      { duration: 1100, easing: "ease-out" }).onfinish = function () { b.remove(); };
  }
  function sweep(oldPile) {
    if (!oldPile.children.length) return;
    oldPile.removeAttribute("id");
    oldPile.style.position = "absolute"; oldPile.style.inset = "0"; oldPile.style.pointerEvents = "none";
    oldPile.querySelectorAll(".t-play").forEach(function (d) { d.classList.remove("top"); d.classList.add("old"); });
    $("feltTable").appendChild(oldPile);
    oldPile.classList.add("t-sweep");
    setTimeout(function () { oldPile.remove(); }, 900);
  }

  // ================= my hand: order, groups, drag to rearrange =================
  function handOrder() {
    var hand = st.hands[G.me];
    var order = (G.order || []).filter(function (c) { return hand.indexOf(c) >= 0; });
    hand.forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); });
    G.order = order;
    G.groups = G.groups || {};
    Object.keys(G.groups).forEach(function (c) { if (hand.indexOf(+c) < 0) delete G.groups[c]; });
    // a "group" of one card is no group
    var count = {};
    Object.keys(G.groups).forEach(function (c) { count[G.groups[c]] = (count[G.groups[c]] || 0) + 1; });
    Object.keys(G.groups).forEach(function (c) { if (count[G.groups[c]] < 2) delete G.groups[c]; });
    return order;
  }
  function grp(c) { return G.groups && G.groups[c] ? G.groups[c] : 0; }
  var layout = { left: {}, cw: 70 };
  function renderHand() {
    var box = $("hand"), order = handOrder();
    box.textContent = "";
    var W = box.clientWidth || 600, cw = W < 600 ? 50 : 70, n = order.length;
    var gaps = 0;
    for (var i = 1; i < n; i++) if (grp(order[i]) !== grp(order[i - 1]) && (grp(order[i]) || grp(order[i - 1]))) gaps += 14;
    var step = n > 1 ? Math.min(cw + 8, (W - cw - gaps) / (n - 1)) : 0;
    var x = Math.max(0, (W - (cw + (n - 1) * step + gaps)) / 2);
    var hintSet = new Set(coach.best && coach.at === G.log.length && G.showCoach ? coach.best.cards : []);
    layout = { left: {}, cw: cw, step: step };
    var groupsSpan = {};
    order.forEach(function (c, idx) {
      if (idx > 0 && grp(c) !== grp(order[idx - 1]) && (grp(c) || grp(order[idx - 1]))) x += 14;
      var b = cardEl(c, { onTap: function () {} });
      b.dataset.c = c;
      b.style.left = x + "px";
      b.style.zIndex = String(idx + 1);
      if (selected.has(c)) b.classList.add("sel");
      if (hintSet.has(c)) b.classList.add("hint");
      layout.left[c] = x;
      if (grp(c)) { var g = groupsSpan[grp(c)] || (groupsSpan[grp(c)] = { a: x, b: x }); g.b = x; }
      box.appendChild(b);
      x += step;
    });
    Object.keys(groupsSpan).forEach(function (g) {
      var bar = el("div", "t-grp");
      bar.style.left = groupsSpan[g].a + "px";
      bar.style.width = (groupsSpan[g].b - groupsSpan[g].a + cw) + "px";
      box.appendChild(bar);
    });
    var selArr = order.filter(function (c) { return selected.has(c); });
    $("btnGroup").disabled = selArr.length < 2;
    $("btnUngroup").disabled = !selArr.some(function (c) { return grp(c); });
    $("btnAutoGroup").hidden = !G.showCoach;
  }

  // tap = select / unselect; drag sideways = move the card
  (function () {
    var drag = null;
    $("hand").addEventListener("pointerdown", function (e) {
      var card = e.target.closest(".pc");
      if (!card || !G || st.over) return;
      drag = { el: card, c: +card.dataset.c, x0: e.clientX, moved: false, id: e.pointerId };
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 8) return;
      if (!drag.moved) { drag.moved = true; drag.el.classList.add("dragging"); try { drag.el.setPointerCapture(e.pointerId); } catch (err) {} }
      drag.el.style.transform = "translateX(" + dx + "px)";
      e.preventDefault();
    }, { passive: false });
    window.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (!d.moved) {
        if (selected.has(d.c)) selected.delete(d.c); else selected.add(d.c);
        render();
        return;
      }
      var x = layout.left[d.c] + (e.clientX - d.x0);
      var others = G.order.filter(function (c) { return c !== d.c; });
      var idx = others.length;
      for (var i = 0; i < others.length; i++) { if (x < layout.left[others[i]]) { idx = i; break; } }
      others.splice(idx, 0, d.c);
      G.order = others;
      // moved away from its group? then it leaves the group
      var g = grp(d.c);
      if (g) {
        var left = others[idx - 1], right = others[idx + 1];
        if (grp(left) !== g && grp(right) !== g) delete G.groups[d.c];
      }
      saveJSON(GAME_KEY, G);
      render();
    });
    window.addEventListener("pointercancel", function () { if (drag) { drag = null; render(); } });
  })();

  function sortHand(bySuit) {
    var key = bySuit ? function (c) { return B.suitOf(c) * 100 + B.rankOf(c); } : function (c) { return c; };
    var order = handOrder(), blocks = {}, list = [];
    order.forEach(function (c) {
      var g = grp(c);
      if (!g) { list.push([c]); return; }
      if (!blocks[g]) { blocks[g] = []; list.push(blocks[g]); }
      blocks[g].push(c);
    });
    list.forEach(function (b) { b.sort(function (a, c) { return key(a) - key(c); }); });
    list.sort(function (a, b) { return key(a[0]) - key(b[0]); });
    G.order = [].concat.apply([], list);
    saveJSON(GAME_KEY, G);
    render();
  }
  $("btnSortRank").addEventListener("click", function () { sortHand(false); });
  $("btnSortSuit").addEventListener("click", function () { sortHand(true); });
  $("btnGroup").addEventListener("click", function () {
    var order = handOrder(), sel = order.filter(function (c) { return selected.has(c); });
    if (sel.length < 2) return;
    G.gseq = (G.gseq || 0) + 1;
    var at = order.indexOf(sel[0]);
    var rest = order.filter(function (c) { return !selected.has(c); });
    var before = order.slice(0, at).filter(function (c) { return !selected.has(c); }).length;
    rest.splice(before, 0, ...sel);
    sel.forEach(function (c) { G.groups[c] = G.gseq; });
    G.order = rest;
    selected.clear();
    saveJSON(GAME_KEY, G);
    render();
  });
  $("btnUngroup").addEventListener("click", function () {
    selected.forEach(function (c) { delete G.groups[c]; });
    selected.clear();
    saveJSON(GAME_KEY, G);
    render();
  });
  $("btnAutoGroup").addEventListener("click", function () {
    var groups = B.plan(st.hands[G.me], rules, 2).slice().sort(function (a, b) { return a.cards[0] - b.cards[0]; });
    G.groups = {}; G.order = [];
    groups.forEach(function (g) {
      if (g.cards.length > 1) { G.gseq = (G.gseq || 0) + 1; g.cards.forEach(function (c) { G.groups[c] = G.gseq; }); }
      G.order = G.order.concat(g.cards);
    });
    selected.clear();
    saveJSON(GAME_KEY, G);
    render();
  });

  function render() {
    var myTurn = st.turn === G.me;
    renderSeats();
    renderPile();
    $("myName").textContent = G.names[G.me];
    $("turnbar").textContent = myTurn ? "Your turn" : (G.names[st.turn] + "'s turn" + (G.mode === "practice" ? "…" : ""));
    $("myBox").classList.toggle("myturn", myTurn);

    // opponent entry (real table)
    var oppTurn = G.mode === "track" && !myTurn;
    $("oppBox").hidden = !oppTurn;
    if (oppTurn) {
      $("oppLabel").textContent = G.names[st.turn] + " played — tap the cards, then Record (or Pass)";
      var mine = new Set(st.hands[G.me]), gone = new Set(st.played);
      buildGrid($("oppGrid"), function (c) {
        var unavailable = mine.has(c) || gone.has(c);
        return { mine: mine.has(c), gone: gone.has(c), disabled: unavailable, selected: oppSel.has(c), onTap: function (card) {
          if (oppSel.has(card)) oppSel.delete(card); else if (oppSel.size < 5) oppSel.add(card);
          render();
        } };
      });
      $("btnOppPlay").disabled = oppSel.size === 0;
      $("btnOppPass").disabled = !st.table;
    }

    renderHand();
    var cnt = st.hands[G.me].length;
    $("handInfo").textContent = cnt + (cnt === 1 ? " card" : " cards") + " · if someone goes out now you'd count " + (B.cardValue(cnt) + B.twosPenalty(st.hands[G.me])) + " pts";
    $("btnPlay").disabled = !myTurn || selected.size === 0;
    $("btnPass").disabled = !myTurn || !st.table;
    $("btnUseHint").hidden = !G.showCoach;
    $("btnUseHint").disabled = !myTurn || !coach.best || coach.at !== G.log.length;

    renderCoach();
    renderTracker();
  }
  window.addEventListener("resize", function () { if (G && st && !$("vPlay").hidden) renderHand(); });

  // card counting, from my point of view only (never peeks at the bots' hands)
  function renderTracker() {
    var unseen = B.unseenCards(st.hands[G.me], st.played);
    var parts = [];
    parts.push("<b>" + st.played.length + "</b> cards played, <b>" + unseen.length + "</b> not seen yet" +
      (G.n < 4 ? " (" + (52 - 13 * G.n) + " of them are in the untouched pile)" : "") + ".");
    var twos = unseen.filter(function (c) { return B.rankOf(c) === 12; });
    parts.push("2s still out: <b>" + (twos.length ? twos.map(B.label).join(" ") : "none") + "</b>");
    var myHigh = st.hands[G.me][st.hands[G.me].length - 1];
    var higher = unseen.filter(function (c) { return c > myHigh; });
    if (myHigh != null) {
      parts.push(higher.length
        ? "Cards that beat your best single (" + B.label(myHigh) + "): <b>" + higher.length + "</b>"
        : "Your <b>" + B.label(myHigh) + "</b> is the highest single left — nobody can beat it.");
    }
    $("tracker").innerHTML = parts.join("<br>");
  }

  function renderCoach() {
    var body = $("coachBody"); body.textContent = "";
    if (!G.showCoach) {
      body.appendChild(el("p", "thinking", G.challenge
        ? "Challenge on: the Coach is playing this same hand on its own. Compare points at the end."
        : "Suggestions are switched off for this game."));
      return;
    }
    if (st.turn !== G.me || coach.at !== G.log.length || !coach.best) {
      body.appendChild(el("p", "thinking", st.turn === G.me ? "Thinking…" : "Waiting for your turn…"));
      return;
    }
    var best = coach.best;
    body.appendChild(el("div", "sugg", best.combo ? B.describe(best.combo) : "Pass"));
    var why = best.reason;
    if (best.stats && best.tag !== "win") {
      why = (coach.winnable ? "Best expected points. " : "This round is hard to win — playing to lose the fewest points. ") + why;
      why += " Simulated over " + best.stats.runs + " deals: average " + fmt(best.stats.avg) + " pts, you win " + Math.round(best.stats.win * 100) + "%.";
    }
    body.appendChild(el("p", "why", why));
    if (coach.pending) body.appendChild(el("p", "thinking", "Checking the alternatives…"));
    var ranked = coach.list.filter(function (c) { return c.stats; });
    if (ranked.length > 1) {
      body.appendChild(el("p", "label", "Top moves (chance to win · avg points, ranked by points)"));
      var alts = el("div", "alts");
      ranked.slice(0, 3).forEach(function (c) {
        var b = el("button", "alt" + (c === best ? " best" : "")); b.type = "button";
        b.appendChild(el("span", "mv", c.combo ? B.describe(c.combo) : "Pass"));
        b.appendChild(el("span", "w", Math.round(c.stats.win * 100) + "%"));
        b.appendChild(el("span", "a " + (c.stats.avg >= 0 ? "up" : "down"), fmt(c.stats.avg)));
        b.addEventListener("click", function () { selected = new Set(c.cards); render(); });
        alts.appendChild(b);
      });
      body.appendChild(alts);
    }
  }

  // ================= the coach =================
  function coachView() {
    return {
      n: st.n, me: G.me, myHand: st.hands[G.me].slice(), played: st.played.slice(), counts: st.counts.slice(),
      table: st.table ? st.table.cards.slice() : null, lastBy: st.lastBy, passes: st.passes, passed: st.passed.slice(),
      firstPlay: st.firstPlay, mustInclude: st.mustInclude
    };
  }
  // The goal is POINTS: pick the move with the best average result over the simulated deals.
  // (Winning pays the most, so it is already counted; a long-shot win no longer outweighs a big loss.)
  // Moves within half a point of each other count as equal; then the better chance to win decides.
  var POINTS_TIE = 0.5;
  function rankList() {
    var withStats = coach.list.filter(function (c) { return c.stats; });
    if (!withStats.length) return;
    withStats.sort(function (a, b) { return (b.stats.avg - a.stats.avg) || (b.stats.win - a.stats.win); });
    var top = withStats[0].stats.avg;
    var pool = withStats.filter(function (c) { return c.stats.avg >= top - POINTS_TIE; });
    pool.sort(function (a, b) { return b.stats.win - a.stats.win; });
    coach.best = pool[0];
    coach.winnable = coach.best.stats.win >= 1 / (G.n + 1);
    var goOut = coach.list.filter(function (c) { return c.tag === "win"; })[0];
    if (goOut) coach.best = goOut;
    withStats.splice(withStats.indexOf(coach.best), 1);
    withStats.unshift(coach.best);
    coach.list = withStats.concat(coach.list.filter(function (c) { return !c.stats; }));
  }
  function runCoach() {
    var view = coachView(), at = G.log.length;
    var res = B.coachCandidates(view, G.rules);
    coach = { at: at, list: res.candidates, best: res.candidates[0] || null, pending: res.candidates.length > 1 };
    render();
    if (res.candidates.length <= 1) return;
    var id = ++simSeq, payload = { id: id, view: view, candidates: res.candidates.map(function (c) { return c.cards; }), rules: G.rules, iterations: 500, timeBudget: 1500, seed: (Date.now() & 0xffff) + at };
    function done(results) {
      if (id !== simSeq || coach.at !== at) return;
      results.forEach(function (r, i) { coach.list[i].stats = r; });
      coach.pending = false;
      rankList();
      if (st && st.turn === G.me && G.log.length === at) render();
    }
    try {
      if (!worker) worker = new Worker("sim-worker.js");
      worker.onmessage = function (e) { if (e.data.id === id) done(e.data.results); };
      worker.onerror = function () { worker = null; setTimeout(function () { done(B.simulate(payload.view, payload.candidates, payload.rules, { iterations: 150, timeBudget: 800, seed: payload.seed })); }, 30); };
      worker.postMessage(payload);
    } catch (err) {
      setTimeout(function () { done(B.simulate(payload.view, payload.candidates, payload.rules, { iterations: 150, timeBudget: 800, seed: payload.seed })); }, 30);
    }
  }

  // ================= challenge: the Coach plays the same hand =================
  function startShadow() {
    if (shadowRunning || !G || !G.challenge || G.shadow) return;
    shadowRunning = true;
    var game = { n: G.n, hands: G.hands, start: G.start, mustInclude: G.mustInclude, rules: G.rules, seed: G.seed, me: G.me, iterations: 300, timeBudget: 2500 };
    var forGame = G.seed;
    function done(result) {
      shadowRunning = false;
      if (!G || G.seed !== forGame) return;
      G.shadow = result;
      saveJSON(GAME_KEY, G);
      if (G.done) saveChallenge();
      if (!$("vEnd").hidden) renderChallenge();
    }
    try {
      var w = new Worker("sim-worker.js");
      w.onmessage = function (e) { if (e.data.type === "shadow") { done(e.data.result); w.terminate(); } };
      w.onerror = function () { w.terminate(); setTimeout(function () { done(B.playShadow(game)); }, 50); };
      w.postMessage({ type: "shadow", id: forGame, game: game });
    } catch (err) {
      setTimeout(function () { done(B.playShadow(game)); }, 50);
    }
  }

  function renderChallenge() {
    var box = $("challengeBox");
    box.hidden = !G.challenge;
    $("anaBox").hidden = true;
    if (!G.challenge) return;
    var mine = B.settle(B.roundValues(st))[G.me];
    var row = $("vsRow"); row.textContent = "";
    function card(who, pts, det, lead) {
      var c = el("div", "vs-card" + (lead ? " lead" : ""));
      c.appendChild(el("div", "who", who));
      c.appendChild(el("div", "pts " + (pts >= 0 ? "up" : "down"), pts == null ? "…" : fmt(pts)));
      c.appendChild(el("div", "det", det));
      return c;
    }
    var myDet = (st.winner === G.me ? "You went out first" : st.counts[G.me] + (st.counts[G.me] === 1 ? " card left" : " cards left")) +
      (st.winner !== G.me && B.twosPenalty(st.hands[G.me]) ? " · holding " + st.hands[G.me].filter(function (c) { return B.rankOf(c) === 12; }).map(B.label).join(" ") : "");
    var sh = G.shadow;
    if (!sh) {
      row.appendChild(card("You", mine, myDet, false));
      row.appendChild(card("Coach", null, "still playing its game…", false));
      $("verdict").textContent = "The Coach is finishing the same hand in the background…";
      $("coachPlays").hidden = true;
      return;
    }
    var coachDet = (sh.won ? "Went out first" : sh.cardsLeft[G.me] + (sh.cardsLeft[G.me] === 1 ? " card left" : " cards left")) +
      (!sh.won && sh.twos[G.me].length ? " · holding " + sh.twos[G.me].join(" ") : "");
    row.appendChild(card("You", mine, myDet, mine > sh.net));
    row.appendChild(card("Coach", sh.net, coachDet, sh.net > mine));
    var diff = Math.round((mine - sh.net) * 10) / 10;
    $("verdict").textContent = diff > 0 ? "You beat the Coach by " + diff + " points on this hand!"
      : diff < 0 ? "The Coach did " + Math.abs(diff) + " points better on this hand."
      : "A tie — you and the Coach scored the same.";
    var list = $("coachPlayList"); list.textContent = "";
    sh.coachMoves.forEach(function (m) {
      list.appendChild(el("li", null, m.play + (m.on === "lead" ? " (leading)" : " — on " + m.on)));
    });
    $("coachPlays").hidden = !sh.coachMoves.length;
    renderAnalysis(mine - sh.net);
  }

  // ================= challenge history + decision analysis =================
  function loadHistory() { return loadJSON(HISTORY_KEY) || []; }
  function saveChallenge() {
    if (!G || !G.challenge || !G.done || !G.shadow) return;
    var hist = loadHistory();
    var you = B.settle(B.roundValues(st))[G.me];
    var rec = hist.filter(function (r) { return r.seed === G.seed; })[0];
    if (!rec) {
      rec = {
        v: 1, at: new Date().toISOString(), n: G.n, names: G.names, me: G.me, rules: G.rules, seed: G.seed,
        hands: G.hands, dead: G.dead, start: G.start, mustInclude: G.mustInclude,
        you: { log: G.log, net: you, won: st.winner === G.me, cardsLeft: st.counts[G.me] },
        coach: { log: G.shadow.log, net: G.shadow.net, won: G.shadow.won, cardsLeft: G.shadow.cardsLeft[G.me] },
        analysis: null
      };
      hist.push(rec);
      if (hist.length > 300) hist = hist.slice(-300);
      saveJSON(HISTORY_KEY, hist);
    }
    if (!rec.analysis && !G.analysisRunning) startAnalysis(rec);
  }
  function startAnalysis(rec) {
    G.analysisRunning = true;
    var input = { n: rec.n, hands: rec.hands, start: rec.start, mustInclude: rec.mustInclude, rules: rec.rules, me: rec.me, log: rec.you.log };
    var seed = rec.seed;
    function done(result) {
      if (G && G.seed === seed) { G.analysisRunning = false; G.analysis = result; saveJSON(GAME_KEY, G); }
      var hist = loadHistory();
      hist.forEach(function (r) { if (r.seed === seed) r.analysis = result; });
      saveJSON(HISTORY_KEY, hist);
      if (G && G.seed === seed && !$("vEnd").hidden) renderChallenge();
    }
    try {
      var w = new Worker("sim-worker.js");
      w.onmessage = function (e) { if (e.data.type === "analyze") { done(e.data.result); w.terminate(); } };
      w.onerror = function () { w.terminate(); setTimeout(function () { done(B.analyzeGame(input, { iterations: 150 })); }, 50); };
      w.postMessage({ type: "analyze", id: seed, rec: input, iterations: 300 });
    } catch (err) {
      setTimeout(function () { done(B.analyzeGame(input, { iterations: 150 })); }, 50);
    }
  }
  function renderAnalysis(actualDiff) {
    var box = $("anaBox"), list = $("anaList");
    box.hidden = false;
    list.textContent = "";
    var a = G.analysis;
    if (!a) { $("anaSummary").textContent = "Analysing each of your decisions…"; return; }
    if (!a.length) { $("anaSummary").textContent = "You had no decisions to make in this round."; return; }
    var gain = a.reduce(function (s, d) { return s + d.gain; }, 0);
    var same = a.filter(function (d) { return d.same; }).length;
    var unseen = a.filter(function (d) { return !d.considered; }).length;
    var luck = actualDiff - gain;
    $("anaSummary").textContent =
      "You chose the same move as the Coach " + same + " of " + a.length + " times. " +
      "Your different choices were worth " + fmt(gain) + " expected points compared with the Coach's" +
      (unseen ? " — " + unseen + " of your moves weren't even on the Coach's list of options" : "") + ". " +
      "The rest of the gap (" + fmt(luck) + ") came from the luck of how the cards and bots fell afterwards.";
    a.forEach(function (d) {
      var row = el("div", "ana-row" + (d.same ? " same" : ""));
      row.appendChild(el("div", null, "Play " + (d.at + 1)));
      row.appendChild(el("div", "sit", d.cardsBefore + " cards · " + (d.onTable === "you lead" ? "leading" : "on " + d.onTable)));
      row.appendChild(el("div", null, "You: " + d.mine));
      row.appendChild(el("div", null, "Coach: " + (d.same ? "same" : d.coach)));
      row.appendChild(el("div", "g " + (d.gain > 0.05 ? "up" : d.gain < -0.05 ? "down" : ""), d.same ? "—" : fmt(d.gain)));
      if (!d.considered) row.appendChild(el("div", "flag", "Your move wasn't among the Coach's candidates."));
      list.appendChild(row);
    });
  }

  function renderHistory() {
    var hist = loadHistory(), box = $("histBox");
    box.hidden = !hist.length;
    if (!hist.length) return;
    var you = 0, coachPts = 0, youBetter = 0, coachBetter = 0, decGain = 0, analysed = 0;
    hist.forEach(function (r) {
      you += r.you.net; coachPts += r.coach.net;
      if (r.you.net > r.coach.net) youBetter++; else if (r.you.net < r.coach.net) coachBetter++;
      if (r.analysis) { analysed++; r.analysis.forEach(function (d) { decGain += d.gain; }); }
    });
    $("histSummary").innerHTML = "<b>" + hist.length + "</b> games · You <b>" + fmt(you) + "</b> pts vs Coach <b>" + fmt(coachPts) + "</b> pts · " +
      "you did better in <b>" + youBetter + "</b>, the Coach in <b>" + coachBetter + "</b>" +
      (analysed ? " · your different decisions were worth <b>" + fmt(decGain) + "</b> expected pts" : "") + ".";
    var list = $("histList"); list.textContent = "";
    hist.slice().reverse().slice(0, 30).forEach(function (r) {
      var row = el("div", "hist-row");
      row.appendChild(el("span", "d", new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })));
      row.appendChild(el("span", r.you.net >= 0 ? "up" : "down", "You " + fmt(r.you.net)));
      row.appendChild(el("span", r.coach.net >= 0 ? "up" : "down", "Coach " + fmt(r.coach.net)));
      var d = r.you.net - r.coach.net;
      row.appendChild(el("span", null, d > 0 ? "You +" + d : d < 0 ? "Coach +" + (-d) : "Tie"));
      list.appendChild(row);
    });
  }
  $("btnHistClear").addEventListener("click", function () {
    if (!confirm("Delete all saved challenge games on this device? Export them first if you want to keep them.")) return;
    saveJSON(HISTORY_KEY, []);
    renderHistory();
  });
  $("btnHistExport").addEventListener("click", function () {
    var hist = loadHistory();
    var data = {
      app: "Big Two Coach", kind: "challenge-history", exported: new Date().toISOString(),
      cardCodes: "card = rank*4 + suit; rank 0..12 = 3,4,5,6,7,8,9,10,J,Q,K,A,2; suit 0..3 = diamonds, clubs, hearts, spades",
      games: hist
    };
    var text = JSON.stringify(data);
    var name = "bigtwo-challenges-" + new Date().toISOString().slice(0, 10) + ".json";
    var file = null;
    try { file = new File([text], name, { type: "application/json" }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Big Two challenge history" }).catch(function () {});
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  // ================= buttons =================
  function playMine(cards) {
    var cb = cards.length ? B.classify(cards, rules) : null;
    if (cards.length && !cb) { $("playMsg").textContent = "That's not a valid play (single, pair, triple or five-card hand)."; return; }
    var err = B.checkMove(st, G.me, cb, rules);
    if (err) { $("playMsg").textContent = err; return; }
    if (G.showCoach && coach.at === G.log.length && coach.best) {
      var sameAsCoach = coach.best.cards.join(",") === (cb ? cb.cards.join(",") : "");
      if (!sameAsCoach) {
        var mineStats = coach.list.filter(function (c) { return c.cards.join(",") === (cb ? cb.cards.join(",") : ""); })[0];
        G.review.push({
          at: G.log.length, played: cb ? B.describe(cb) : "Pass", suggested: coach.best.combo ? B.describe(coach.best.combo) : "Pass",
          reason: coach.best.reason, bestAvg: coach.best.stats ? coach.best.stats.avg : null,
          mineAvg: mineStats && mineStats.stats ? mineStats.stats.avg : null
        });
      }
    }
    record(G.me, cb);
  }
  $("btnPlay").addEventListener("click", function () { playMine(B.sortCards(Array.from(selected))); });
  $("btnPass").addEventListener("click", function () { playMine([]); });
  $("btnUseHint").addEventListener("click", function () { if (coach.best) { selected = new Set(coach.best.cards); render(); } });
  $("btnOppPlay").addEventListener("click", function () {
    var cards = B.sortCards(Array.from(oppSel)), cb = B.classify(cards, rules);
    if (!cb) { $("playMsg").textContent = "Those cards aren't a valid play (single, pair, triple or five-card hand)."; return; }
    var err = B.checkMove(st, st.turn, cb, rules);
    if (err) { $("playMsg").textContent = err; return; }
    record(st.turn, cb);
  });
  $("btnOppPass").addEventListener("click", function () {
    var err = B.checkMove(st, st.turn, null, rules);
    if (err) { $("playMsg").textContent = err; return; }
    record(st.turn, null);
  });
  $("btnUndo").addEventListener("click", function () {
    if (!G || !G.log.length) return;
    clearTimeout(botTimer);
    if (G.mode === "practice") {
      // go back to your previous decision (the bots' replies are removed with it)
      var k = G.log.length - 1;
      while (k >= 0 && G.log[k].p !== G.me) k--;
      if (k < 0) return;
      G.log = G.log.slice(0, k);
    } else {
      G.log.pop();
    }
    G.review = G.review.filter(function (r) { return r.at < G.log.length; });
    G.done = false;
    coach.at = -1;
    selected.clear(); oppSel.clear();
    $("playMsg").textContent = "";
    show("vPlay");
    afterChange();
  });
  $("btnLog").addEventListener("click", function () {
    var box = $("log"); box.textContent = "";
    if (!G.log.length) box.appendChild(el("div", null, "No plays yet."));
    G.log.forEach(function (e, i) {
      box.appendChild(el("div", null, (i + 1) + ". " + nameOf(e.p) + " — " + (e.cards ? B.describe(B.classify(e.cards, rules)) : "Pass")));
    });
    $("logSheet").hidden = false;
    box.scrollTop = box.scrollHeight;
  });
  $("btnLogClose").addEventListener("click", function () { $("logSheet").hidden = true; });
  $("logSheet").addEventListener("click", function (e) { if (e.target === $("logSheet")) $("logSheet").hidden = true; });
  $("btnHome").addEventListener("click", function () { clearTimeout(botTimer); renderHome(); });

  // ================= round end =================
  function finish() {
    clearTimeout(botTimer);
    G.done = true;
    saveJSON(GAME_KEY, G);
    var known = G.mode === "practice";
    var values = B.roundValues(st), net = B.settle(values);
    $("endTitle").textContent = st.winner === G.me ? "You win the round!" : G.names[st.winner] + " wins the round";
    var t = $("endTable"); t.textContent = "";
    var head = el("tr");
    ["Player", "Cards left", "2s in hand", "Points", "Net (×1)"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(head);
    var lines = ["BIG TWO — round result (" + new Date().toLocaleDateString("en-GB") + ")"];
    for (var i = 0; i < G.n; i++) {
      var tr = el("tr"), handKnown = !!st.hands[i];
      var twos = handKnown ? st.hands[i].filter(function (c) { return B.rankOf(c) === 12; }).map(B.label) : null;
      tr.appendChild(el("td", null, nameOf(i)));
      tr.appendChild(el("td", null, String(st.counts[i])));
      tr.appendChild(el("td", null, i === st.winner ? "—" : (twos ? (twos.join(" ") || "none") : "?")));
      tr.appendChild(el("td", null, i === st.winner ? String(values[i]) : (handKnown ? String(values[i]) : "≥ " + values[i])));
      var netCell = el("td", known ? (net[i] >= 0 ? "up" : "down") : null, known ? fmt(net[i]) : "—");
      tr.appendChild(netCell);
      t.appendChild(tr);
      lines.push(G.names[i] + ": " + st.counts[i] + " cards left" + (twos && twos.length ? ", holding " + twos.join(" ") : ""));
    }
    $("endNote").textContent = known
      ? "Points use the calculator's formula at level ×1."
      : "Other players' 2s aren't known to the coach — tick them in the calculator when you enter this round.";
    var params = new URLSearchParams({ num: G.n });
    G.names.forEach(function (nm, k) { params.set("player" + (k + 1), nm); });
    $("btnOpenCalc").href = "../?" + params.toString();
    $("btnCopy").onclick = function () {
      var text = lines.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { $("btnCopy").textContent = "Copied ✓"; }, function () { prompt("Copy:", text); });
      else prompt("Copy:", text);
    };
    $("btnCopy").textContent = "Copy summary";
    if (G.challenge && G.shadow) saveChallenge();
    renderChallenge();
    if (G.challenge && !G.shadow) startShadow();
    var rv = $("review"); rv.textContent = "";
    $("reviewBox").hidden = !(known && G.showCoach);
    if (known && G.showCoach) {
      if (!G.review.length) rv.appendChild(el("div", null, "You followed the coach on every move."));
      G.review.forEach(function (r) {
        var line = "Play " + (r.at + 1) + ": you played " + r.played + ", the coach suggested " + r.suggested + ".";
        if (r.bestAvg != null && r.mineAvg != null) line += " (Simulated average: coach " + fmt(r.bestAvg) + " vs yours " + fmt(r.mineAvg) + " pts.)";
        line += " " + r.reason;
        rv.appendChild(el("div", null, line));
      });
    }
    show("vEnd");
  }
  $("btnAgain").addEventListener("click", function () {
    if (G.mode === "practice") dealPractice(); else { setup.me = G.me; startEntry(); }
  });
  $("btnEndMenu").addEventListener("click", renderHome);

  renderHome();
})();
