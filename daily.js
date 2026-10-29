// daily.js -- the "Today" routine: which 10 puzzles to serve today, and the
// streak. Pure functions over a plain state object; index.html stores the state
// in localStorage, test/daily.test.js runs these same functions in Node.
// Served on the public site (no personal data in here).
(function (root) {
  var DAY_SIZE = 10;
  var NEW_POOL_PER_DAY = 5;   // fresh Lichess puzzles every day, never eaten by reviews
  var MAX_REVIEWS_PER_DAY = 2;
  var REVIEW_AFTER_DAYS = 3;  // a missed pool puzzle comes back this many days later
  var OWN_FIRST_GAP = 3;      // own-game puzzle solved: back in 3 days, then 6, 12...
  var OWN_MAX_GAP = 60;

  // The streak day is the UTC date, on purpose: in Dubai it flips at 4:00am, so
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
    return { day: null, set: [], kind: {}, done: {}, cursor: 0, carry: [], due: {}, own: {},
      streak: 0, best: 0, lastDone: null, history: {} };
  }

  // Takes the next n pool ids not already in `taken`: first the ones carried
  // over unfinished from the previous day, then onward from the cursor (one
  // full pass at most, so a tiny pool can't loop forever).
  function takeNewPool(state, pool, n, taken) {
    var out = [];
    var poolIds = {};
    pool.forEach(function (p) { poolIds[p.id] = true; });
    while (state.carry.length && out.length < n) {
      var c = state.carry.shift();
      if (poolIds[c] && !taken[c]) { out.push(c); taken[c] = true; }
    }
    for (var tries = 0; out.length < n && tries < pool.length; tries++) {
      if (state.cursor >= pool.length) state.cursor = 0; // pool exhausted: start over
      var id = pool[state.cursor].id;
      state.cursor++;
      if (!taken[id] && !(id in state.due)) { out.push(id); taken[id] = true; }
    }
    return out;
  }

  // Today's set, built once per day and kept (reopening never reshuffles):
  // up to 2 due reviews + 5 new pool puzzles + own-game puzzles that are due,
  // topped up with more new pool puzzles to 10.
  function ensureToday(state, pool, own, today) {
    if (state.day === today && state.set.length) return state;
    if (state.day && state.day !== today) {
      // Unfinished new pool puzzles from an earlier day are served first, not skipped.
      state.carry = state.set.filter(function (id) {
        return state.kind[id] === 'pool' && !(id in state.done) && !(id in state.due);
      }).concat(state.carry || []);
    }
    var set = [], kind = {}, taken = {};
    function add(id, k) { set.push(id); kind[id] = k; taken[id] = true; }
    var poolIds = {};
    pool.forEach(function (p) { poolIds[p.id] = true; });

    Object.keys(state.due).filter(function (id) { return state.due[id] <= today && poolIds[id]; })
      .sort(function (a, b) { return state.due[a] < state.due[b] ? -1 : 1; })
      .slice(0, MAX_REVIEWS_PER_DAY).forEach(function (id) { add(id, 'pool'); });
    takeNewPool(state, pool, NEW_POOL_PER_DAY, taken).forEach(function (id) { add(id, 'pool'); });

    var ownDue = own.map(function (o, i) { return { id: o.id, i: i, next: (state.own[o.id] || {}).next || '' }; })
      .filter(function (o) { return o.next <= today && !taken[o.id]; })
      .sort(function (a, b) { return a.next < b.next ? -1 : a.next > b.next ? 1 : a.i - b.i; });
    for (var j = 0; j < ownDue.length && set.length < DAY_SIZE; j++) add(ownDue[j].id, 'own');
    if (set.length < DAY_SIZE) takeNewPool(state, pool, DAY_SIZE - set.length, taken).forEach(function (id) { add(id, 'pool'); });

    state.day = today;
    state.set = set;
    state.kind = kind;
    state.done = {};
    return state;
  }

  // After the 10, "10 more" adds fresh pool puzzles to the same day (no effect on the streak).
  function addMore(state, pool, n) {
    var taken = {};
    state.set.forEach(function (id) { taken[id] = true; });
    takeNewPool(state, pool, n || DAY_SIZE, taken).forEach(function (id) { state.set.push(id); state.kind[id] = 'pool'; });
    return state;
  }

  function nextPuzzleId(state) {
    for (var i = 0; i < state.set.length; i++) if (!(state.set[i] in state.done)) return state.set[i];
    return null;
  }

  function progress(state) {
    return { done: Object.keys(state.done).length, total: state.set.length };
  }

  function dayFinished(state) {
    return state.lastDone === state.day;
  }

  // Records one finished puzzle against the set's own day (so a puzzle finished
  // just after the day flips still counts for the set it belongs to). Returns
  // true when this completed the day's first 10.
  function recordResult(state, id, solved) {
    if (!state.day || state.set.indexOf(id) < 0 || id in state.done) return false;
    var day = state.day;
    state.done[id] = !!solved;
    if (state.kind[id] === 'own') {
      var o = state.own[id] || { gap: 0 };
      o.gap = solved ? Math.min(OWN_MAX_GAP, o.gap ? o.gap * 2 : OWN_FIRST_GAP) : 0;
      o.next = addDays(day, solved ? o.gap : 1);
      state.own[id] = o;
    } else if (solved) {
      delete state.due[id];
    } else {
      state.due[id] = addDays(day, REVIEW_AFTER_DAYS);
    }
    if (dayFinished(state)) return false;
    var firstTen = state.set.slice(0, DAY_SIZE);
    for (var i = 0; i < firstTen.length; i++) if (!(firstTen[i] in state.done)) return false;
    state.streak = state.lastDone === addDays(day, -1) ? state.streak + 1 : 1;
    state.lastDone = day;
    if (state.streak > state.best) state.best = state.streak;
    var correct = 0;
    firstTen.forEach(function (k) { if (state.done[k]) correct++; });
    state.history[day] = { done: firstTen.length, correct: correct };
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
    addMore: addMore, nextPuzzleId: nextPuzzleId, progress: progress, dayFinished: dayFinished,
    recordResult: recordResult, streakFor: streakFor,
    DAY_SIZE: DAY_SIZE, NEW_POOL_PER_DAY: NEW_POOL_PER_DAY, REVIEW_AFTER_DAYS: REVIEW_AFTER_DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Daily;
  else root.Daily = Daily;
})(this);
