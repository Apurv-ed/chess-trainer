// daily.js -- the "Today" routine: which 10 puzzles to serve today, and the
// streak. Pure functions over a plain state object; index.html stores the state
// in localStorage, test/daily.test.js runs these same functions in Node.
// Served on the public site (no personal data in here).
(function (root) {
  var POOL_PER_DAY = 5;       // Lichess puzzles aimed at the measured leaks
  var OWN_PER_DAY = 5;        // positions from the user's own games
  var MAX_REVIEWS_PER_DAY = 3;
  var REVIEW_AFTER_DAYS = 3;  // a missed puzzle comes back this many days later

  // The streak day is the UTC date, on purpose: in India it flips at 5:30am, so
  // a set finished just after midnight still counts for the evening before
  // (the owner asked for this on 2026-10-29).
  function streakDay(d) {
    return (d || new Date()).toISOString().slice(0, 10);
  }

  // Calendar arithmetic on YYYY-MM-DD strings (used by addDays).
  function localDay(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function addDays(day, n) {
    var parts = day.split('-').map(Number);
    return localDay(new Date(parts[0], parts[1] - 1, parts[2] + n));
  }

  function emptyState() {
    return { day: null, set: [], done: {}, cursor: 0, ownCursor: 0, due: {}, streak: 0, best: 0, lastDone: null, history: {} };
  }

  // Today's set: due reviews first (missed earlier), then the next unseen pool
  // puzzles, then own-game positions rotating through the list. Built once per
  // day and kept, so reopening the app never reshuffles a half-done day.
  function ensureToday(state, pool, own, today) {
    if (state.day === today && state.set.length) return state;
    // A new day: if yesterday's set was left unfinished, the streak is judged
    // in streakFor(); here we just build the new set.
    var set = [];
    var dueIds = Object.keys(state.due).filter(function (id) { return state.due[id] <= today; }).sort();
    var poolIds = {};
    pool.forEach(function (p) { poolIds[p.id] = true; });
    dueIds.forEach(function (id) { if (set.length < MAX_REVIEWS_PER_DAY && poolIds[id]) set.push(id); });
    var cursor = state.cursor;
    // At most one full pass over the pool, so a pool smaller than a day's
    // quota can't loop forever.
    for (var tries = 0; set.length < POOL_PER_DAY && tries < pool.length; tries++) {
      if (cursor >= pool.length) cursor = 0; // pool exhausted: start over
      var id = pool[cursor].id;
      cursor++;
      if (set.indexOf(id) < 0) set.push(id);
    }
    var ownCursor = state.ownCursor;
    for (var i = 0; i < OWN_PER_DAY && i < own.length; i++) {
      set.push(own[ownCursor % own.length].id);
      ownCursor++;
    }
    state.day = today;
    state.set = set;
    state.done = {};
    state.cursor = cursor;
    state.ownCursor = own.length ? ownCursor % own.length : 0;
    return state;
  }

  function nextPuzzleId(state) {
    for (var i = 0; i < state.set.length; i++) if (!(state.set[i] in state.done)) return state.set[i];
    return null;
  }

  function progress(state) {
    return { done: Object.keys(state.done).length, total: state.set.length };
  }

  // Records one finished puzzle. Returns true when this completed the day.
  function recordResult(state, id, solved, today) {
    if (state.day !== today || state.set.indexOf(id) < 0 || id in state.done) return false;
    state.done[id] = !!solved;
    if (solved) delete state.due[id];
    else state.due[id] = addDays(today, REVIEW_AFTER_DAYS);
    var p = progress(state);
    if (p.done < p.total) return false;
    if (state.lastDone !== today) {
      state.streak = state.lastDone === addDays(today, -1) ? state.streak + 1 : 1;
      state.lastDone = today;
      if (state.streak > state.best) state.best = state.streak;
      var correct = 0;
      Object.keys(state.done).forEach(function (k) { if (state.done[k]) correct++; });
      state.history[today] = { done: p.total, correct: correct };
    }
    return true;
  }

  // The streak as it stands today: a day missed since the last finished day
  // breaks it (shown as 0 until today's set is done).
  function streakFor(state, today) {
    if (!state.lastDone) return 0;
    if (state.lastDone === today || state.lastDone === addDays(today, -1)) return state.streak;
    return 0;
  }

  var Daily = {
    streakDay: streakDay, localDay: localDay, addDays: addDays, emptyState: emptyState, ensureToday: ensureToday,
    nextPuzzleId: nextPuzzleId, progress: progress, recordResult: recordResult, streakFor: streakFor,
    POOL_PER_DAY: POOL_PER_DAY, OWN_PER_DAY: OWN_PER_DAY, REVIEW_AFTER_DAYS: REVIEW_AFTER_DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Daily;
  else root.Daily = Daily;
})(this);
