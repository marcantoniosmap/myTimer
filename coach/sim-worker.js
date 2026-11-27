/* Runs the coach's simulations, the Coach's own challenge game, and the after-game analysis
   in the background so the screen never freezes. */
importScripts("engine.js");

self.onmessage = function (e) {
  var d = e.data;
  if (d.type === "shadow") {
    self.postMessage({ id: d.id, type: "shadow", result: self.BigTwo.playShadow(d.game) });
    return;
  }
  if (d.type === "analyze") {
    self.postMessage({ id: d.id, type: "analyze", result: self.BigTwo.analyzeGame(d.rec, { iterations: d.iterations }) });
    return;
  }
  var results = self.BigTwo.simulate(d.view, d.candidates, d.rules, { iterations: d.iterations, timeBudget: d.timeBudget, seed: d.seed });
  self.postMessage({ id: d.id, results: results });
};
