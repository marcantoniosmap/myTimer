/* Big Two practice coach: game engine (no screen code, so it also runs in the background worker).
 *
 * Cards are numbers 0..51:  rank = card >> 2  (0 = "3" … 11 = "A", 12 = "2")
 *                           suit = card & 3   (0 ♦, 1 ♣, 2 ♥, 3 ♠)
 * so a higher number is always a higher single card.
 *
 * House rules (agreed with the table, all switchable in Settings):
 *  - straights: 10-J-Q-K-A, 2-3-4-5-6 (lowest, 2 counts low) and J-Q-K-A-2 (highest) allowed;
 *    A-2-3-4-5 and wrap-arounds not allowed; ranked in natural order;
 *    equal straights: suit of the highest card decides (the 6 in 2-3-4-5-6, the 2 in J-Q-K-A-2)
 *  - flush vs flush: suit first
 *  - no bombs (four of a kind / straight flush only beat other five-card hands)
 *  - holder of the 3♦ leads (3 players: if it is in the untouched pile, the lowest card in play leads)
 *  - scoring = the calculator's formula (cards-left bands, 2s left in hand, finishing with 2s)
 */
(function (root) {
  "use strict";

  var RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  var SUITS = ["♦", "♣", "♥", "♠"];
  var SUIT_WORDS = ["diamonds", "clubs", "hearts", "spades"];
  var FIVE_NAMES = ["", "straight", "flush", "full house", "four of a kind", "straight flush"];

  var DEFAULT_RULES = {
    allow26: true,          // 2-3-4-5-6 counts as a straight (the lowest)
    allowJ2: true,          // J-Q-K-A-2 counts as a straight (the highest)
    allowA5: false,         // A-2-3-4-5
    flushSuitFirst: true,   // flush vs flush: suit decides first
    bombs: false,           // four of a kind / straight flush may beat singles, pairs, triples
    firstMustInclude: true, // the very first play must include the starting card (3♦ or the lowest card)
    passLocksOut: true      // once you pass, you can't rejoin until that trick is over (house rule)
  };

  function rankOf(c) { return c >> 2; }
  function suitOf(c) { return c & 3; }
  function label(c) { return RANKS[rankOf(c)] + SUITS[suitOf(c)]; }
  function isRed(c) { var s = suitOf(c); return s === 0 || s === 2; }
  function sortCards(a) { return a.slice().sort(function (x, y) { return x - y; }); }

  // ---------- rules ----------
  function makeRules(r) {
    var rules = Object.assign({}, DEFAULT_RULES, r || {});
    var seqs = [];
    if (rules.allowA5) seqs.push({ ranks: [11, 12, 0, 1, 2], order: 0, top: 2 });
    if (rules.allow26) seqs.push({ ranks: [12, 0, 1, 2, 3], order: 1, top: 3 });
    for (var k = 0; k <= 7; k++) seqs.push({ ranks: [k, k + 1, k + 2, k + 3, k + 4], order: 2 + k, top: k + 4 });
    if (rules.allowJ2) seqs.push({ ranks: [8, 9, 10, 11, 12], order: 10, top: 12 });
    var bySig = {};
    seqs.forEach(function (s) { bySig[s.ranks.slice().sort(function (a, b) { return a - b; }).join(",")] = s; });
    Object.defineProperty(rules, "_seqs", { value: seqs, enumerable: false });
    Object.defineProperty(rules, "_seqBySig", { value: bySig, enumerable: false });
    return rules;
  }

  // ---------- combinations ----------
  function combo(t, k, cards, key) { return { t: t, k: k, cards: cards, key: key }; }

  function classify(cards, rules) {
    var cs = sortCards(cards), n = cs.length, i;
    if (n === 1) return combo("single", 0, cs, cs[0]);
    if (n === 2 || n === 3) {
      for (i = 1; i < n; i++) if (rankOf(cs[i]) !== rankOf(cs[0])) return null;
      return combo(n === 2 ? "pair" : "triple", 0, cs, cs[n - 1]);
    }
    if (n !== 5) return null;
    var counts = {}, sameSuit = true;
    for (i = 0; i < 5; i++) {
      var r = rankOf(cs[i]);
      counts[r] = (counts[r] || 0) + 1;
      if (suitOf(cs[i]) !== suitOf(cs[0])) sameSuit = false;
    }
    var ranks = Object.keys(counts).map(Number);
    if (ranks.length === 5) {
      var seq = rules._seqBySig[ranks.slice().sort(function (a, b) { return a - b; }).join(",")];
      if (seq) {
        var top = cs.filter(function (c) { return rankOf(c) === seq.top; })[0];
        var kind = sameSuit ? 5 : 1;
        return combo("five", kind, cs, kind * 1e9 + seq.order * 4 + suitOf(top));
      }
    }
    if (sameSuit) {
      var sig = 0;
      cs.map(rankOf).sort(function (a, b) { return b - a; }).forEach(function (r2) { sig = sig * 13 + r2; });
      var sub = rules.flushSuitFirst ? suitOf(cs[0]) * 1e7 + sig : sig * 4 + suitOf(cs[0]);
      return combo("five", 2, cs, 2e9 + sub);
    }
    if (ranks.length === 2) {
      var a = ranks[0], b = ranks[1];
      if (counts[a] === 3 || counts[b] === 3) return combo("five", 3, cs, 3e9 + (counts[a] === 3 ? a : b));
      if (counts[a] === 4 || counts[b] === 4) return combo("five", 4, cs, 4e9 + (counts[a] === 4 ? a : b));
    }
    return null;
  }

  function beats(a, b, rules) {
    if (!a) return false;
    if (!b) return true;
    if (rules.bombs && a.t === "five" && a.k >= 4 && b.t !== "five") return true;
    if (a.t !== b.t) return false;
    return a.key > b.key;
  }

  function describe(cb) {
    if (!cb) return "Pass";
    var r = RANKS[rankOf(cb.cards[0])];
    if (cb.t === "single") return label(cb.cards[0]);
    if (cb.t === "pair") return "Pair of " + r + "s";
    if (cb.t === "triple") return "Three " + r + "s";
    var name = FIVE_NAMES[cb.k];
    return name.charAt(0).toUpperCase() + name.slice(1) + " " + cb.cards.map(label).join(" ");
  }

  function byRank(hand) {
    var m = new Map();
    hand.forEach(function (c) { var r = rankOf(c); if (!m.has(r)) m.set(r, []); m.get(r).push(c); });
    m.forEach(function (v) { v.sort(function (a, b) { return a - b; }); });
    return m;
  }

  function kCombos(arr, k) {
    var out = [], cur = [];
    (function rec(start) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); rec(i + 1); cur.pop(); }
    })(0);
    return out;
  }

  function genSingles(hand) { return hand.map(function (c) { return combo("single", 0, [c], c); }); }

  function genGroups(hand, size) {
    var out = [];
    byRank(hand).forEach(function (cs) {
      if (cs.length >= size) kCombos(cs, size).forEach(function (sub) { out.push(combo(size === 2 ? "pair" : "triple", 0, sub, sub[size - 1])); });
    });
    return out;
  }

  function genFives(hand, rules) {
    var out = [], seen = new Set(), m = byRank(hand), bySuit = [[], [], [], []];
    hand.forEach(function (c) { bySuit[suitOf(c)].push(c); });
    function add(cs) {
      var s = sortCards(cs), id = s.join(",");
      if (seen.has(id)) return;
      seen.add(id);
      var cb = classify(s, rules);
      if (cb) out.push(cb);
    }
    rules._seqs.forEach(function (seq) {
      if (!seq.ranks.every(function (r) { return m.has(r); })) return;
      var partial = [[]];
      seq.ranks.forEach(function (r) {
        var next = [];
        partial.forEach(function (p) { m.get(r).forEach(function (c) { next.push(p.concat(c)); }); });
        partial = next;
      });
      partial.forEach(add);
    });
    bySuit.forEach(function (s) { if (s.length >= 5) kCombos(s, 5).forEach(add); });
    var ranks = Array.from(m.keys());
    ranks.forEach(function (r) {
      var cs = m.get(r);
      if (cs.length >= 3) {
        kCombos(cs, 3).forEach(function (tri) {
          ranks.forEach(function (r2) {
            if (r2 !== r && m.get(r2).length >= 2) kCombos(m.get(r2), 2).forEach(function (pr) { add(tri.concat(pr)); });
          });
        });
      }
      if (cs.length === 4) hand.forEach(function (c) { if (rankOf(c) !== r) add(cs.concat([c])); });
    });
    return out;
  }

  function allCombos(hand, rules) {
    return genSingles(hand).concat(genGroups(hand, 2), genGroups(hand, 3), genFives(hand, rules));
  }

  function legalMoves(hand, table, rules, mustInclude) {
    var list;
    if (!table) list = allCombos(hand, rules);
    else if (table.t === "single") list = genSingles(hand);
    else if (table.t === "pair") list = genGroups(hand, 2);
    else if (table.t === "triple") list = genGroups(hand, 3);
    else list = genFives(hand, rules);
    if (table && rules.bombs && table.t !== "five") list = list.concat(genFives(hand, rules).filter(function (c) { return c.k >= 4; }));
    list = list.filter(function (c) { return beats(c, table, rules); });
    if (mustInclude != null) list = list.filter(function (c) { return c.cards.indexOf(mustInclude) >= 0; });
    return list;
  }

  // ---------- scoring: exactly the calculator's formula ----------
  function cardValue(n) {
    n = n | 0;
    if (n < 5) return n;
    if (n < 9) return n * 2;
    if (n < 13) return n * 3;
    if (n < 17) return n * 4;
    if (n < 21) return n * 5;
    return n * 6;
  }
  function twosPenalty(hand) {
    var v = 0;
    (hand || []).forEach(function (c) { if (rankOf(c) === 12) v += suitOf(c) === 3 ? 10 : 5; });
    return v;
  }
  function finishBonus(last) {
    if (!last || !last.cards.every(function (c) { return rankOf(c) === 12; })) return 0;
    if (last.t === "triple") return -50;
    if (last.t === "pair") return -25;
    if (last.t === "single") return -10;
    return 0;
  }
  // pairwise: whoever has more points pays the difference to each other player
  function settle(values) {
    var n = values.length, sum = values.reduce(function (a, b) { return a + b; }, 0);
    return values.map(function (v) { return sum - n * v; });
  }
  function roundValues(st) {
    return st.counts.map(function (cnt, i) {
      if (i === st.winner) return finishBonus(st.lastCombo);
      return cardValue(cnt) + twosPenalty(st.hands[i]);
    });
  }

  // ---------- game state ----------
  // hands: array per player (null = unknown, e.g. opponents at a real table)
  function startingCard(hands, deadPile) {
    var inPlay = [];
    hands.forEach(function (h) { if (h) inPlay = inPlay.concat(h); });
    if (deadPile && deadPile.indexOf(0) < 0 && inPlay.indexOf(0) >= 0) return 0;
    return inPlay.length ? Math.min.apply(null, inPlay) : 0;
  }

  function newGame(o) {
    var n = o.n;
    return {
      n: n,
      hands: o.hands.map(function (h) { return h ? sortCards(h) : null; }),
      counts: o.counts ? o.counts.slice() : o.hands.map(function (h) { return h ? h.length : 13; }),
      table: null, lastBy: -1, passes: 0, passed: new Array(n).fill(false),
      turn: o.start, firstPlay: true, mustInclude: o.mustInclude == null ? null : o.mustInclude,
      played: [], log: [], over: false, winner: -1, lastCombo: null
    };
  }

  function cloneState(st) {
    return {
      n: st.n, hands: st.hands.map(function (h) { return h ? h.slice() : null; }), counts: st.counts.slice(),
      table: st.table, lastBy: st.lastBy, passes: st.passes, passed: st.passed.slice(), turn: st.turn,
      firstPlay: st.firstPlay, mustInclude: st.mustInclude, played: st.played.slice(), log: [], over: st.over,
      winner: st.winner, lastCombo: st.lastCombo
    };
  }

  // Returns an error message if the move is not allowed, otherwise null.
  function checkMove(st, p, cb, rules) {
    if (st.over) return "The round is over.";
    if (p !== st.turn) return "It isn't this player's turn.";
    if (!cb) return st.table ? null : "You can't pass when you lead — play anything.";
    if (st.hands[p]) {
      for (var i = 0; i < cb.cards.length; i++) if (st.hands[p].indexOf(cb.cards[i]) < 0) return "That card isn't in the hand.";
    } else if (cb.cards.length > st.counts[p]) return "That player doesn't have that many cards left.";
    if (st.mustInclude != null && cb.cards.indexOf(st.mustInclude) < 0) return "The first play must include the " + label(st.mustInclude) + ".";
    if (!beats(cb, st.table, rules)) {
      if (st.table && cb.t !== st.table.t) return "You must play the same kind as the table (" + st.table.t + ").";
      return "That doesn't beat " + describe(st.table) + ".";
    }
    return null;
  }

  function applyMove(st, p, cb, rules) {
    if (cb) {
      if (st.hands[p]) st.hands[p] = st.hands[p].filter(function (c) { return cb.cards.indexOf(c) < 0; });
      st.counts[p] -= cb.cards.length;
      st.played = st.played.concat(cb.cards);
      st.table = cb; st.lastBy = p; st.passes = 0;
      // with the house rule, whoever passed stays out until this trick is over
      if (!rules.passLocksOut) st.passed.fill(false);
      st.firstPlay = false; st.mustInclude = null;
      if (st.counts[p] <= 0) { st.over = true; st.winner = p; st.lastCombo = cb; }
    } else {
      st.passes++; st.passed[p] = true;
    }
    st.log.push({ p: p, cards: cb ? cb.cards.slice() : null });
    if (st.over) return;
    var n = st.n, next = (p + 1) % n;
    var trickDone = rules.passLocksOut
      ? st.passed.filter(function (x, i) { return x && i !== st.lastBy; }).length >= n - 1
      : st.passes >= n - 1;
    if (st.table && trickDone) {
      st.table = null; st.passes = 0; st.passed.fill(false); next = st.lastBy;
    } else if (rules.passLocksOut && st.table) {
      var guard = 0;
      while (st.passed[next] && next !== st.lastBy && guard++ < n) next = (next + 1) % n;
    }
    st.turn = next;
  }

  // ---------- hand planning ----------
  // Split a hand into groups: five-card hands, then triples, pairs and singles.
  function rankGroups(hand) {
    var groups = [];
    byRank(hand).forEach(function (cs) {
      if (cs.length === 4) { groups.push(combo("pair", 0, cs.slice(0, 2), cs[1])); groups.push(combo("pair", 0, cs.slice(2), cs[3])); }
      else if (cs.length === 3) groups.push(combo("triple", 0, cs, cs[2]));
      else if (cs.length === 2) groups.push(combo("pair", 0, cs, cs[1]));
      else groups.push(combo("single", 0, cs, cs[0]));
    });
    return groups;
  }
  function planScore(groups) {
    // fewer groups is better; then prefer fewer low singles (they are the hardest to get rid of)
    var lowSingles = groups.filter(function (g) { return g.t === "single" && rankOf(g.cards[0]) < 8; }).length;
    var singles = groups.filter(function (g) { return g.t === "single"; }).length;
    return groups.length * 100 + lowSingles * 10 + singles;
  }
  function plan(hand, rules, depth) {
    depth = depth == null ? 2 : depth;
    var best = rankGroups(hand), bestScore = planScore(best);
    if (depth > 0 && hand.length >= 5) {
      var fives = genFives(hand, rules);
      if (fives.length > 120) fives = fives.slice(0, 120);
      fives.forEach(function (f) {
        var rest = hand.filter(function (c) { return f.cards.indexOf(c) < 0; });
        var g = [f].concat(plan(rest, rules, depth - 1));
        var s = planScore(g);
        if (s < bestScore) { best = g; bestScore = s; }
      });
    }
    return best;
  }

  // ---------- card tracking ----------
  function unseenCards(myHand, played) {
    var gone = new Set(myHand.concat(played)), out = [];
    for (var c = 0; c < 52; c++) if (!gone.has(c)) out.push(c);
    return out;
  }
  // Could anybody still beat this group with the cards not yet seen?
  function canBeBeaten(group, unseen, rules) {
    if (group.t === "single") return unseen.some(function (c) { return c > group.cards[0]; });
    if (group.t === "pair" || group.t === "triple") {
      var size = group.cards.length;
      return genGroups(unseen, size).some(function (g) { return g.key > group.key; });
    }
    if (unseen.length > 26) return true; // too early to be sure about five-card hands
    return genFives(unseen, rules).some(function (f) { return beats(f, group, rules); });
  }

  // ---------- bots (opponents in practice mode, and every player in simulations) ----------
  function minOthers(st, p) {
    var m = 99;
    for (var i = 0; i < st.n; i++) if (i !== p && st.counts[i] < m) m = st.counts[i];
    return m;
  }
  function botMove(st, p, rules, rnd) {
    var hand = st.hands[p];
    rnd = rnd || Math.random;
    if (!st.table) return botLead(st, p, rules);
    var options = legalMoves(hand, st.table, rules, st.mustInclude);
    if (!options.length) return null;
    var counts = byRank(hand), danger = minOthers(st, p) <= 2, endgame = hand.length <= 5;
    var best = null, bestCost = Infinity;
    options.forEach(function (o) {
      if (o.cards.length === hand.length) { best = o; bestCost = -Infinity; return; } // goes out
      if (bestCost === -Infinity) return;
      var cost = o.key / 1e10;
      var r = rankOf(o.cards[0]);
      if (o.t !== "five" && counts.get(r).length > o.cards.length) cost += 3;   // breaks a pair / triple
      var twos = o.cards.filter(function (c) { return rankOf(c) === 12; }).length;
      if (twos && !danger && !endgame) cost += 4 * twos;
      if (o.t === "single" && rankOf(o.cards[0]) === 11 && !danger) cost += 1;
      if (cost < bestCost) { best = o; bestCost = cost; }
    });
    if (bestCost >= 4 && !danger && rnd() < 0.65) return null;
    return best;
  }
  function botLead(st, p, rules) {
    var hand = st.hands[p];
    if (st.mustInclude != null) {
      var opts = legalMoves(hand, null, rules, st.mustInclude);
      opts.sort(function (a, b) { return b.cards.length - a.cards.length || a.key - b.key; });
      return opts[0];
    }
    var all = classify(hand, rules);
    if (all) return all; // whole hand is one play: go out
    var groups = plan(hand, rules, 1);
    var nextCount = st.counts[(p + 1) % st.n];
    var nonSingles = groups.filter(function (g) { return g.t !== "single"; });
    if (nextCount === 1) {
      if (nonSingles.length) return nonSingles.sort(function (a, b) { return a.key - b.key; })[0];
      return combo("single", 0, [hand[hand.length - 1]], hand[hand.length - 1]);
    }
    var fives = groups.filter(function (g) { return g.t === "five"; });
    if (fives.length) return fives.sort(function (a, b) { return a.key - b.key; })[0];
    // otherwise lead the group that holds the lowest card
    var lowest = hand[0];
    return groups.filter(function (g) { return g.cards.indexOf(lowest) >= 0; })[0] || combo("single", 0, [lowest], lowest);
  }

  // ---------- simulation ----------
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // view = what the coach is allowed to know: my hand, cards played, how many cards everyone holds, the table.
  // candidates = list of card arrays (empty array = pass).
  function simulate(view, candidates, rulesIn, opts) {
    var rules = makeRules(rulesIn);
    opts = opts || {};
    var maxIter = opts.iterations || 300, budget = opts.timeBudget || 1200, t0 = Date.now();
    var rnd = rng(opts.seed || 12345);
    var me = view.me, n = view.n;
    var unseen = unseenCards(view.myHand, view.played);
    var stats = candidates.map(function () { return { sum: 0, wins: 0, count: 0 }; });
    var iter = 0;
    while (iter < maxIter && Date.now() - t0 < budget) {
      var pool = shuffle(unseen.slice(), rnd), hands = [], k = 0;
      for (var i = 0; i < n; i++) {
        if (i === me) { hands.push(view.myHand.slice()); continue; }
        hands.push(pool.slice(k, k + view.counts[i])); k += view.counts[i];
      }
      candidates.forEach(function (cards, ci) {
        var st = {
          n: n, hands: hands.map(function (h) { return h.slice(); }), counts: view.counts.slice(),
          table: view.table ? classify(view.table, rules) : null, lastBy: view.lastBy, passes: view.passes,
          passed: (view.passed || new Array(n).fill(false)).slice(), turn: me, firstPlay: view.firstPlay,
          mustInclude: view.mustInclude, played: view.played.slice(), log: [], over: false, winner: -1, lastCombo: null
        };
        applyMove(st, me, cards.length ? classify(cards, rules) : null, rules);
        var steps = 0;
        while (!st.over && steps++ < 400) applyMove(st, st.turn, botMove(st, st.turn, rules, rnd), rules);
        var net = st.over ? settle(roundValues(st))[me] : 0;
        stats[ci].sum += net; stats[ci].count++;
        if (st.winner === me) stats[ci].wins++;
      });
      iter++;
    }
    return stats.map(function (s) {
      return { avg: s.count ? s.sum / s.count : 0, win: s.count ? s.wins / s.count : 0, runs: s.count };
    });
  }

  // ---------- coach ----------
  // Picks a handful of sensible candidate moves and a reason for each (the simulation then compares them).
  function coachCandidates(view, rulesIn) {
    var rules = makeRules(rulesIn);
    var hand = sortCards(view.myHand), table = view.table ? classify(view.table, rules) : null;
    var unseen = unseenCards(hand, view.played);
    var legal = legalMoves(hand, table, rules, view.mustInclude);
    var groups = plan(hand, rules, 2);
    var groupIds = groups.map(function (g) { return g.cards.join(","); });
    var groupOf = {};
    groups.forEach(function (g) { g.cards.forEach(function (c) { groupOf[c] = g; }); });
    var opp = [];
    for (var i = 0; i < view.n; i++) if (i !== view.me) opp.push(view.counts[i]);
    var minOpp = Math.min.apply(null, opp);
    var sure = groups.filter(function (g) { return !canBeBeaten(g, unseen, rules); });
    var out = [], seen = new Set();
    function push(cb, reason, tag) {
      var id = cb ? cb.cards.join(",") : "pass";
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ cards: cb ? cb.cards : [], combo: cb, reason: reason, tag: tag || "" });
    }
    function brokenBy(cb) {
      var broken = [];
      cb.cards.forEach(function (c) {
        var g = groupOf[c];
        if (g && g.cards.length > 1 && g.cards.join(",") !== cb.cards.join(",") && broken.indexOf(g) < 0) broken.push(g);
      });
      return broken;
    }
    var twosIn = function (cb) { return cb.cards.filter(function (c) { return rankOf(c) === 12; }).length; };
    var sizeAfter = function (cb) { return hand.length - cb.cards.length; };

    // 1. Can I go out right now?
    legal.forEach(function (cb) { if (cb.cards.length === hand.length) push(cb, "This plays your last cards — you go out and win the round.", "win"); });

    // 2. Sure winners covering the rest of the hand
    if (!table && sure.length && groups.length - sure.length <= 1) {
      var lead = groups.filter(function (g) { return sure.indexOf(g) < 0; })[0] || sure[0];
      var isSure = sure.indexOf(lead) >= 0;
      push(lead, isSure
        ? "Nobody can beat your remaining groups — play them out one by one."
        : "Your other groups can't be beaten: get rid of this one first, then play your sure winners.", "chain");
    }

    if (!table) {
      // 3. Leading
      if (minOpp === 1) {
        var multi = groups.filter(function (g) { return g.t !== "single"; }).sort(function (a, b) { return a.key - b.key; });
        if (multi.length) push(multi[0], "An opponent has 1 card left: lead a " + (multi[0].t === "five" ? "five-card hand" : multi[0].t) + " so they can't follow with a single.", "safe");
        var high = hand[hand.length - 1];
        push(combo("single", 0, [high], high), "An opponent has 1 card left: if you must lead a single, lead your highest (" + label(high) + ").", "safe");
      }
      var fives = groups.filter(function (g) { return g.t === "five"; }).sort(function (a, b) { return a.key - b.key; });
      fives.forEach(function (f) { push(f, "Lead the " + FIVE_NAMES[f.k] + ": five cards in one turn, and few players can answer it.", "five"); });
      var weakest = groups.filter(function (g) { return g.t !== "five" && sure.indexOf(g) < 0; })
        .sort(function (a, b) { return a.cards[0] - b.cards[0]; });
      weakest.slice(0, 3).forEach(function (g) {
        push(g, "Lead your weakest group (" + describe(g) + ") — it's the hardest to get rid of later; keep your high cards for control.", "weak");
      });
      if (view.mustInclude != null) {
        legal.slice().sort(function (a, b) { return b.cards.length - a.cards.length || a.key - b.key; }).slice(0, 4)
          .forEach(function (cb) { push(cb, "The first play must include the " + label(view.mustInclude) + ". Playing more cards with it gets you closer to going out.", "first"); });
      }
    } else {
      // 4. Following
      var ordered = legal.slice().sort(function (a, b) { return a.key - b.key; });
      var clean = ordered.filter(function (cb) { return brokenBy(cb).length === 0 && !twosIn(cb); });
      if (clean.length) push(clean[0], "Beat it with " + describe(clean[0]) + " — it isn't part of your other groups, so your plan stays intact.", "clean");
      var withTwo = ordered.filter(function (cb) { return twosIn(cb) && brokenBy(cb).length === 0; });
      if (withTwo.length) {
        push(withTwo[0], minOpp <= 2
          ? "An opponent is close to going out — use the 2 to take control now."
          : "Use the 2 to win control; holding 2s at the end costs extra points (+10 for 2♠, +5 for the others).", "two");
      }
      var breaking = ordered.filter(function (cb) { return brokenBy(cb).length > 0; });
      if (breaking.length && !clean.length) {
        var b = breaking[0], br = brokenBy(b)[0];
        push(b, "Beating it means breaking your " + describe(br) + ". Only worth it if it helps you go out.", "break");
      }
      // drop below a points band when the round probably can't be won
      [8, 4].forEach(function (band) {
        var drop = ordered.filter(function (cb) { return hand.length > band && sizeAfter(cb) <= band; })[0];
        if (drop) push(drop, "Gets you down to " + sizeAfter(drop) + " cards: if you don't win, you'd owe " + cardValue(sizeAfter(drop)) + " points instead of " + cardValue(hand.length) + ".", "band");
      });
      if (ordered.length) push(ordered[ordered.length - 1], "Play your strongest answer to win control of the table.", "control");
      push(null, legal.length
        ? "Pass: save your cards — beating this would cost you a strong card or break a group."
        : "You can't beat it — pass.", "pass");
    }
    // only ever suggest moves that are actually allowed right now (e.g. the first play must include the 3♦)
    var legalIds = new Set(legal.map(function (cb) { return cb.cards.join(","); }));
    out = out.filter(function (c) { return c.combo ? legalIds.has(c.cards.join(",")) : !!table; });
    if (!out.length && legal.length) {
      var firstLegal = legal.slice().sort(function (a, b) { return b.cards.length - a.cards.length || a.key - b.key; })[0];
      push(firstLegal, view.mustInclude != null
        ? "The first play must include the " + label(view.mustInclude) + "."
        : "Your only sensible play.", "only");
    }
    return { candidates: out.slice(0, 8), groups: groups, sure: sure, unseen: unseen };
  }

  // ---------- the Coach playing on its own (challenge mode, testing) ----------
  function viewFor(st, me) {
    return {
      n: st.n, me: me, myHand: st.hands[me].slice(), played: st.played.slice(), counts: st.counts.slice(),
      table: st.table ? st.table.cards.slice() : null, lastBy: st.lastBy, passes: st.passes, passed: st.passed.slice(),
      firstPlay: st.firstPlay, mustInclude: st.mustInclude
    };
  }
  // Same rule as the app: best average points; within half a point, the better chance to win.
  function coachChoose(view, rulesIn, opts) {
    var cc = coachCandidates(view, rulesIn).candidates;
    if (!cc.length) return null;
    var goOut = cc.filter(function (c) { return c.tag === "win"; })[0];
    if (goOut) return goOut.combo;
    if (cc.length === 1) return cc[0].combo;
    var stats = simulate(view, cc.map(function (c) { return c.cards; }), rulesIn, opts);
    var top = Math.max.apply(null, stats.map(function (s) { return s.avg; }));
    var best = -1;
    stats.forEach(function (s, i) {
      if (s.avg >= top - 0.5 && (best < 0 || s.win > stats[best].win)) best = i;
    });
    return cc[best].combo;
  }
  // Bots' random choices depend only on the game seed and the move number,
  // so the same deal plays out the same way for you and for the Coach (until your choices differ).
  function botRng(seed, moveNo) { return rng((seed >>> 0) * 1009 + moveNo * 7919 + 17); }
  // Plays a whole round with the Coach in seat `me` and bots everywhere else.
  function playShadow(o) {
    var rules = makeRules(o.rules);
    var st = newGame({ n: o.n, hands: o.hands, start: o.start, mustInclude: o.mustInclude });
    var steps = 0, coachMoves = [];
    while (!st.over && steps++ < 500) {
      var p = st.turn, mv;
      if (p === o.me) {
        mv = coachChoose(viewFor(st, p), o.rules, { iterations: o.iterations || 300, timeBudget: o.timeBudget || 2500, seed: (o.seed >>> 0) + st.log.length * 31 });
        coachMoves.push({ at: st.log.length, play: mv ? describe(mv) : "Pass", on: st.table ? describe(st.table) : "lead" });
      } else {
        mv = botMove(st, p, rules, botRng(o.seed, st.log.length));
      }
      applyMove(st, p, mv, rules);
    }
    var values = roundValues(st);
    return {
      winner: st.winner, won: st.winner === o.me, net: settle(values)[o.me], values: values,
      cardsLeft: st.counts.slice(), twos: st.hands.map(function (h) { return (h || []).filter(function (c) { return rankOf(c) === 12; }).map(label); }),
      coachMoves: coachMoves, plays: st.log.length, log: st.log
    };
  }

  // ---------- after a challenge: how good was each of YOUR decisions? ----------
  // Replays your game. At every one of your turns it re-simulates that exact position and compares
  // the move you made with the move the Coach would have made (in expected points).
  function coachIndex(cc, stats) {
    var goOut = -1;
    cc.forEach(function (c, i) { if (c.tag === "win") goOut = i; });
    if (goOut >= 0) return goOut;
    var idxs = cc.map(function (c, i) { return i; }).filter(function (i) { return cc[i].tag !== "yours"; });
    var top = Math.max.apply(null, idxs.map(function (i) { return stats[i].avg; }));
    var best = -1;
    idxs.forEach(function (i) { if (stats[i].avg >= top - 0.5 && (best < 0 || stats[i].win > stats[best].win)) best = i; });
    return best;
  }
  function analyzeGame(rec, opts) {
    opts = opts || {};
    var rules = makeRules(rec.rules);
    var st = newGame({ n: rec.n, hands: rec.hands, start: rec.start, mustInclude: rec.mustInclude });
    var out = [];
    rec.log.forEach(function (e) {
      var cb = e.cards ? classify(e.cards, rules) : null;
      if (e.p === rec.me && !st.over) {
        var view = viewFor(st, rec.me);
        var cc = coachCandidates(view, rec.rules).candidates.slice();
        var key = function (cards) { return cards && cards.length ? sortCards(cards).join(",") : "pass"; };
        var mine = cc.map(function (c) { return key(c.cards); }).indexOf(key(e.cards));
        var considered = mine >= 0;
        if (!considered) {
          cc.push({ cards: e.cards ? e.cards.slice() : [], combo: cb, reason: "", tag: "yours" });
          mine = cc.length - 1;
        }
        var stats = cc.length > 1
          ? simulate(view, cc.map(function (c) { return c.cards; }), rec.rules, { iterations: opts.iterations || 300, timeBudget: opts.timeBudget || 4000, seed: 7771 + st.log.length })
          : [{ avg: 0, win: 0, runs: 0 }];
        var ci = cc.length > 1 ? coachIndex(cc, stats) : 0;
        out.push({
          at: st.log.length, onTable: st.table ? describe(st.table) : "you lead", cardsBefore: st.hands[rec.me].length,
          mine: cb ? describe(cb) : "Pass", coach: cc[ci].combo ? describe(cc[ci].combo) : "Pass",
          same: ci === mine, considered: considered, options: cc.length,
          mineAvg: stats[mine].avg, coachAvg: stats[ci].avg, mineWin: stats[mine].win, coachWin: stats[ci].win,
          gain: stats[mine].avg - stats[ci].avg, coachReason: cc[ci].reason || ""
        });
      }
      applyMove(st, e.p, cb, rules);
    });
    return out;
  }

  root.BigTwo = {
    RANKS: RANKS, SUITS: SUITS, SUIT_WORDS: SUIT_WORDS, FIVE_NAMES: FIVE_NAMES, DEFAULT_RULES: DEFAULT_RULES,
    rankOf: rankOf, suitOf: suitOf, label: label, isRed: isRed, sortCards: sortCards,
    makeRules: makeRules, classify: classify, beats: beats, describe: describe,
    allCombos: allCombos, legalMoves: legalMoves, genFives: genFives,
    cardValue: cardValue, twosPenalty: twosPenalty, finishBonus: finishBonus, settle: settle, roundValues: roundValues,
    startingCard: startingCard, newGame: newGame, cloneState: cloneState, checkMove: checkMove, applyMove: applyMove,
    plan: plan, unseenCards: unseenCards, canBeBeaten: canBeBeaten, botMove: botMove,
    rng: rng, shuffle: shuffle, simulate: simulate, coachCandidates: coachCandidates,
    viewFor: viewFor, coachChoose: coachChoose, botRng: botRng, playShadow: playShadow, analyzeGame: analyzeGame
  };
})(typeof self !== "undefined" ? self : this);
