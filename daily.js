// Log It — daily line: mantras, prompts, and quotes for the #hint slot.
// Pure data + pure selection. index.html renders it; tests.js asserts on it.
//
// Entry shape: { text, when?, author? }
//   when:   'am' (shown before 5pm), 'pm' (5pm on), absent = either window
//   author: attribution line for quotes; absent for mantras/prompts

const DAILY_LINES = [
  // ── mantras: either window ──
  { text: 'Begin again.' },
  { text: 'Slow is smooth. Smooth is fast.' },
  { text: 'Do the boring maintenance now.' },
  { text: 'Small rows add up.' },
  { text: 'One thing at a time.' },
  { text: 'Write it down or lose it.' },
  { text: 'Trust the log, not the memory.' },
  { text: 'Consistency beats intensity.' },
  { text: 'If it matters, it gets measured.' },
  { text: 'Keep the streak boring.' },
  { text: 'Attention is the budget.' },
  { text: 'The system works if you feed it.' },
  { text: 'Momentum is a maintenance item.' },
  { text: 'No zero days.' },
  { text: 'Future you reads this.' },
  { text: 'Log the bad days too.' },
  { text: 'Round numbers are usually lies.' },
  { text: 'When in doubt, note it down.' },
  { text: "You can't improve what you won't look at." },
  { text: 'Boring works.' },
  { text: 'Enough is a number. Find it.' },
  { text: 'Two minutes now or twenty later.' },
  { text: "The car doesn't care how you feel about oil changes." },
  { text: 'Data first, drama later.' },
  { text: 'Guessing is expensive.' },
  { text: 'Show up. Write down. Repeat.' },
  { text: 'Nothing fancy. Just today.' },
  { text: 'Precision is a favor to future you.' },
  { text: 'Ten honest minutes beat an hour of pretending.' },
  { text: 'Name it and it gets smaller.' },
  { text: "If you can't say it in one sentence, you don't know it yet." },
  { text: 'Cheap now or expensive later. Pick one.' },
  { text: 'Most problems are maintenance problems.' },
  { text: 'Simple scales. Clever breaks.' },
  { text: "The note you don't take is the one you'll need." },
  { text: 'A short log beats a long memory.' },

  // ── more mantras: either window ──
  { text: 'Log it before you second-guess it.' },
  { text: "The sheet doesn't judge." },
  { text: 'Half a plan beats a whole intention.' },
  { text: 'Memory is a storyteller, not a witness.' },
  { text: "Today's numbers, not last week's vibes." },
  { text: 'The receipt is the record.' },
  { text: 'If it happened, it counts.' },
  { text: 'Check the oil at the pump. It costs you nothing.' },
  { text: 'A mistake you name is one you can stop repeating.' },
  { text: 'The dashboard light is a deadline.' },
  { text: 'Tips add up faster than memory does.' },
  { text: "Supplements don't work if you forget you took them." },
  { text: 'An idea unwritten is an idea gone by lunch.' },
  { text: 'The car tells you before it breaks. Write down what it says.' },
  { text: 'Every shift has a number. Find it.' },
  { text: "Meals count even when you didn't plan them." },
  { text: 'Prevention is cheaper than the doctor.' },
  { text: 'Nobody remembers the third Tuesday. The log does.' },
  { text: "You didn't imagine the noise. Go look." },
  { text: 'One row now saves one argument later.' },
  { text: 'Count the cash before you leave the lot.' },
  { text: 'Maintenance is cheaper before the smoke.' },
  { text: "Write it down while it's still boring." },
  { text: "A missed oil change doesn't announce itself." },
  { text: 'A rough idea beats a perfect one you never had time for.' },
  { text: 'Notice it before you explain it away.' },
  { text: 'Vitamins in the cupboard do nothing.' },
  { text: 'The bad shift counts as experience too.' },
  { text: 'The easy stuff still counts.' },
  { text: 'Small entries, honest totals.' },
  { text: "The car doesn't forgive skipped rows either." },
  { text: 'Write the number, not the excuse.' },
  { text: 'Cash in hand beats a number you half-remember.' },
  { text: "Nobody needs your best handwriting. Just your honesty." },
  { text: "Today's mileage matters more than today's mood." },
  { text: 'Every idea deserves thirty seconds before it evaporates.' },
  { text: 'The fridge lies. The log does not.' },
  { text: 'A warning light is information, not an opinion.' },
  { text: "You can't average what you didn't record." },
  { text: 'Skipping one day makes the next one easier to skip.' },
  { text: "The tip pool doesn't care what you meant to do." },
  { text: 'A confident guess is still a guess.' },
  { text: 'The idea worth having is worth one line.' },
  { text: 'Nobody regrets the entry they made. Plenty regret the one they skipped.' },
  { text: "Don't let the weird thing become normal." },
  { text: "The car's maintenance log is a letter to your future self." },
  { text: "Don't let anyone round your hours down. Including you." },
  { text: "The supplement bottle doesn't count itself." },
  { text: "Today's entry is tomorrow's evidence." },
  { text: 'A quiet day is still a day.' },
  { text: "You'll forget the exact number. Write it now." },
  { text: 'One honest row is worth ten memories.' },
  { text: 'The maintenance you skip shows up as a repair.' },
  { text: 'Good ideas survive being written down badly.' },
  { text: 'You always misremember tips upward.' },
  { text: 'The car remembers what you did to it.' },
  { text: 'Facts age better than feelings.' },
  { text: 'Nobody sees the maintenance. That is the job.' },
  { text: "Every entry is a small bet on future you." },
  { text: "If it's worth doing, it's worth three seconds of setup." },
  { text: "The odometer doesn't lie. Neither should the log." },
  { text: 'A missed meal entry is a missed data point, not a missed meal.' },
  { text: "Today's total is just yesterday's plus one entry." },
  { text: 'Late beats never. Usually.' },
  { text: "Shower thoughts don't come back." },
  { text: 'The tank is emptier than it looks. So is the memory.' },
  { text: 'What you repeat becomes what you are.' },
  { text: 'Short and honest beats long and vague.' },
  { text: 'Some days the only win is the entry itself.' },
  { text: 'Move before the doubt finishes talking.' },
  { text: 'Tired is a reason to go slower, not to stop.' },
  { text: 'One line is still a log.' },
  { text: "The car's next problem is hiding in today's noise." },
  { text: 'You already did the work. Logging it takes ten seconds.' },
  { text: "Today's row is tomorrow's proof." },

  // ── morning ──
  { text: 'What are you putting off that takes five minutes?', when: 'am' },
  { text: "What's the one thing worth writing down today?", when: 'am' },
  { text: 'What would make today feel like a win by dinner?', when: 'am' },
  { text: "What's today's one non-negotiable?", when: 'am' },
  { text: 'Where does the first hour go?', when: 'am' },
  { text: "What's likely to go sideways today — and what's the plan?", when: 'am' },
  { text: 'What can you set up now that tonight-you will thank you for?', when: 'am' },
  { text: 'If today repeated a hundred times, which habit would win?', when: 'am' },
  { text: "What's worth doing badly today so it exists at all?", when: 'am' },
  { text: 'What deserves your best two hours today?', when: 'am' },
  { text: "What's one thing you can finish — not start — today?", when: 'am' },
  { text: "What's the cheapest upgrade to today's routine?", when: 'am' },
  { text: 'What did yesterday teach you that today can use?', when: 'am' },
  { text: "What's on the list only because it's always been on the list?", when: 'am' },
  { text: 'What are you pretending not to know this morning?', when: 'am' },
  { text: 'Hardest thing first. Coffee optional.', when: 'am' },
  { text: "Start before you're ready.", when: 'am' },
  { text: 'Set the day before it sets you.', when: 'am' },
  { text: 'First entry sets the tone.', when: 'am' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', author: 'Proverb', when: 'am' },
  { text: 'Well begun is half done.', author: 'Aristotle', when: 'am' },
  { text: 'At dawn, when you have trouble getting out of bed, tell yourself: I have to go to work — as a human being.', author: 'Marcus Aurelius', when: 'am' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden', when: 'am' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus', when: 'am' },

  // ── more morning ──
  { text: "What's the first number you'll need today?", when: 'am' },
  { text: "What are you hoping nobody asks about today?", when: 'am' },
  { text: 'Set out what the shift needs before you need it.', when: 'am' },
  { text: 'Do the small thing you keep stepping over.', when: 'am' },
  { text: 'What does the car need that you keep putting off?', when: 'am' },
  { text: 'Decide what you eat today before you get hungry.', when: 'am' },
  { text: 'Pop the hood before you leave. Two minutes.', when: 'am' },
  { text: "What's the one idea you had in the shower this morning?", when: 'am' },
  { text: 'What would today look like if you tracked it honestly?', when: 'am' },
  { text: "What's the first tip you'll want to remember tonight?", when: 'am' },
  { text: 'What supplement did you almost forget again?', when: 'am' },
  { text: "What's today's most likely excuse — and can you skip it?", when: 'am' },
  { text: 'Which errand keeps sliding to tomorrow?', when: 'am' },
  { text: "What number will you wish you'd written down by 6pm?", when: 'am' },
  { text: "What's the one thing today that isn't optional?", when: 'am' },
  { text: "What's the smallest honest goal for today?", when: 'am' },
  { text: "Where is today's slack — and who's going to spend it?", when: 'am' },
  { text: 'What did the car sound like this morning?', when: 'am' },
  { text: "What's the first decision you're avoiding?", when: 'am' },
  { text: 'Do one thing now that makes tonight easier.', when: 'am' },
  { text: 'Do the boring thing that works.', when: 'am' },
  { text: "What's worth double-checking before you commit to it?", when: 'am' },
  { text: 'What did you promise yourself yesterday that today can deliver?', when: 'am' },
  { text: "What's the one number today hinges on?", when: 'am' },
  { text: 'Buy tomorrow some slack today.', when: 'am' },
  { text: 'What are you walking into without a plan?', when: 'am' },
  { text: 'Start with the thing you least want to start.', when: 'am' },
  { text: 'What would you tell yourself if today already happened?', when: 'am' },
  { text: "What's on today's schedule that you're quietly dreading?", when: 'am' },
  { text: 'One thing well beats three things fast.', when: 'am' },
  { text: 'Yesterday-you left instructions. Follow them.', when: 'am' },
  { text: "What's today's real priority, not the loud one?", when: 'am' },
  { text: 'What would you do first if nobody was watching?', when: 'am' },
  { text: 'Make the appointment you keep almost making.', when: 'am' },
  { text: 'Five minutes now, or two hours in a month.', when: 'am' },
  { text: 'Do the quiet work before the day gets loud.', when: 'am' },
  { text: "What's the first receipt you'll lose if you don't log it now?", when: 'am' },
  { text: "What would surprise future you about today's plan?", when: 'am' },
  { text: 'The thing you keep meaning to do is today.', when: 'am' },
  { text: "What's today's low bar, and can you clear it by noon?", when: 'am' },

  // ── evening ──
  { text: 'What did today actually cost you?', when: 'pm' },
  { text: 'What went better than you expected?', when: 'pm' },
  { text: 'What would you skip tomorrow if nobody noticed?', when: 'pm' },
  { text: 'What did you do today that deserves a row in the sheet?', when: 'pm' },
  { text: 'What surprised you today?', when: 'pm' },
  { text: "What drained you today that shouldn't have?", when: 'pm' },
  { text: "What's one thing you'd redo about today?", when: 'pm' },
  { text: 'Who made today easier?', when: 'pm' },
  { text: 'What did you almost not log?', when: 'pm' },
  { text: "What's still circling in your head? Park it here.", when: 'pm' },
  { text: 'Did today match the plan — and does that matter?', when: 'pm' },
  { text: "What's tomorrow's first move?", when: 'pm' },
  { text: "What did you spend money on today that you'll forget by Friday?", when: 'pm' },
  { text: 'Which hour of today would you want back?', when: 'pm' },
  { text: 'What worked today? Do it again tomorrow.', when: 'pm' },
  { text: 'Done counts.', when: 'pm' },
  { text: 'Close the day like a tab.', when: 'pm' },
  { text: 'The day is logged. Let it go.', when: 'pm' },
  { text: 'You did what you did. Note it and rest.', when: 'pm' },
  { text: 'Park it on paper, not in your head.', when: 'pm' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard', when: 'pm' },
  { text: 'Sleep is the best meditation.', author: 'Dalai Lama', when: 'pm' },
  { text: 'Very little is needed to make a happy life.', author: 'Marcus Aurelius', when: 'pm' },

  // ── more evening ──
  { text: "What did you spend on today that wasn't planned?", when: 'pm' },
  { text: 'Something on the car changed today. Name it.', when: 'pm' },
  { text: 'What tip surprised you tonight, good or bad?', when: 'pm' },
  { text: "What did you eat today that you'd forget by tomorrow?", when: 'pm' },
  { text: 'One idea slipped past you today.', when: 'pm' },
  { text: "What number from today will you need next week?", when: 'pm' },
  { text: 'What did you take today that you almost skipped?', when: 'pm' },
  { text: 'Some of tonight is already fading.', when: 'pm' },
  { text: "Something broke today. Ignoring it has a price.", when: 'pm' },
  { text: "What did today cost that wasn't money?", when: 'pm' },
  { text: "What's the one thing from today worth remembering in a year?", when: 'pm' },
  { text: "What did you fix today that you'll forget you fixed?", when: 'pm' },
  { text: "What noise did the car make today that you're hoping goes away?", when: 'pm' },
  { text: "What's today's number you'd rather not admit?", when: 'pm' },
  { text: 'Part of today went fine. Say which part.', when: 'pm' },
  { text: 'What did you skip logging today, and why?', when: 'pm' },
  { text: "What's the smallest thing today that actually mattered?", when: 'pm' },
  { text: 'Something almost slipped tonight. Catch it.', when: 'pm' },
  { text: 'The honest total beats the round one.', when: 'pm' },
  { text: 'Today confirmed something you already suspected.', when: 'pm' },
  { text: "What's one thing today that deserves a follow-up tomorrow?", when: 'pm' },
  { text: "What did you notice today that you'd normally let slide?", when: 'pm' },
  { text: 'Whose day did you make easier today?', when: 'pm' },
  { text: "What did today's first hour actually get you?", when: 'pm' },
  { text: "What's tonight's number worth double-checking?", when: 'pm' },
  { text: 'It is still sitting there.', when: 'pm' },
  { text: 'Avoiding it took longer than doing it would have.', when: 'pm' },
  { text: 'Today told you something about the car.', when: 'pm' },
  { text: 'Today had a quiet win nobody will ask about.', when: 'pm' },
  { text: 'Something today deserves a little credit.', when: 'pm' },
  { text: "What's the number that made today feel different?", when: 'pm' },
  { text: "What did today's tips actually add up to?", when: 'pm' },
  { text: "What's one thing you'd log differently if you did today again?", when: 'pm' },
  { text: 'What did you eat today without thinking about it?', when: 'pm' },
  { text: "What's the maintenance item today reminded you about?", when: 'pm' },
  { text: "What's the last thing today that's worth a row in the sheet?", when: 'pm' },
  { text: 'What idea from today deserves five more minutes tomorrow?', when: 'pm' },
  { text: "What's today's number that surprised you?", when: 'pm' },
  { text: 'What did you almost let slide tonight?', when: 'pm' },
  { text: 'Easier tonight than tomorrow. Pick one thing.', when: 'pm' },

  // ── quotes: either window ──
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'You could leave life right now. Let that determine what you do and say and think.', author: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'Little strokes fell great oaks.', author: 'Benjamin Franklin' },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Either write something worth reading or do something worth writing.', author: 'Benjamin Franklin' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'Confine yourself to the present.', author: 'Marcus Aurelius' },
  { text: 'You become what you give your attention to.', author: 'Epictetus' },
  { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche' },
  { text: 'The obstacle is the path.', author: 'Zen proverb' },
  { text: 'No man ever steps in the same river twice.', author: 'Heraclitus' },
  { text: 'Inspiration exists, but it has to find you working.', author: 'Pablo Picasso' },
  { text: 'Nothing is so fatiguing as the eternal hanging on of an uncompleted task.', author: 'William James' },
];

// 5pm split: 'am' = midnight-4:59pm (get the day started),
// 'pm' = 5pm-midnight (look back at it). Local time, like the Today view.
function windowFor(date) {
  return date.getHours() < 17 ? 'am' : 'pm';
}

// djb2-xor, unsigned, plus a murmur3 fmix32 avalanche. Hash (not
// dayOfYear % n) so the same calendar date lands differently each year and
// consecutive days don't walk the list. The avalanche is load-bearing:
// djb2-xor alone is near-linear, so consecutive-day keys produced hash
// deltas that were exact multiples of the pool size, repeating the previous
// day's line ~22x/year.
function dailyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// Days since the epoch for a LOCAL calendar date. Date.UTC on the local y/m/d
// keeps this stable across timezones and DST — we want the calendar day, not a
// UTC instant.
function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

// mulberry32 — small, fast, deterministic. Only needs to be well-distributed
// enough to shuffle a list of a few hundred.
function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How far apart two showings of the same line must be across a cycle boundary.
// Scales with the pool so a bigger list buys a bigger gap. Capped at 21.
function minGapFor(n) {
  return Math.max(3, Math.min(21, Math.floor(n / 6)));
}

// Fisher-Yates over indices, seeded per (window, cycle).
function rawOrder(n, cycle, win) {
  const idx = [];
  for (let i = 0; i < n; i++) idx[i] = i;
  const rnd = seededRandom(dailyHash(win + '#' + cycle));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// The order for one cycle, repaired at the boundary. Within a cycle every index
// appears exactly once, so no line can repeat. The only way a repeat can land
// close is across a boundary — a line late in cycle N and early in cycle N+1 —
// so anything from the previous cycle's tail gets pushed out of this cycle's
// head. Without this the observed minimum gap was 2 days.
function orderFor(n, cycle, win) {
  const order = rawOrder(n, cycle, win);
  const gap = minGapFor(n);
  if (n <= gap * 2) return order;          // pool too small to separate; leave it
  const tail = {};
  const prev = rawOrder(n, cycle - 1, win);
  for (let i = n - gap; i < n; i++) tail[prev[i]] = true;
  for (let i = 0; i < gap; i++) {
    if (!tail[order[i]]) continue;
    for (let j = gap; j < n; j++) {
      if (!tail[order[j]]) {
        const t = order[i]; order[i] = order[j]; order[j] = t;
        break;
      }
    }
  }
  return order;
}

// Which entry of `pool` this day gets. `offset` nudges to a different slot.
function scheduledPick(pool, win, day, offset) {
  const n = pool.length;
  const cycle = Math.floor(day / n);
  const pos = day - cycle * n;             // always 0..n-1, negatives included
  return pool[orderFor(n, cycle, win)[(pos + (offset || 0)) % n]];
}

function lineFor(date, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const win = windowFor(date);
  const pool = lines.filter((l) => !l.when || l.when === win);
  if (pool.length === 0) return null;

  const day = dayNumber(date);
  const pick = scheduledPick(pool, win, day);

  // Untagged lines live in BOTH pools, so an evening pick can land on the line
  // already shown that morning. Nudge to a different slot instead of filtering
  // the pool — filtering would change pool length and so shift the whole
  // rotation. The nudge must NOT be +1: that slot is tomorrow's regularly
  // scheduled pick (pos increments by 1 per day), so borrowing it here shows
  // the same line again tomorrow — a manufactured back-to-back repeat. Half
  // the pool away is far outside any realistic min-gap window, so it can't
  // collide with a neighboring day's pick. Cost: that cycle skips one pm
  // line, ~2x/year.
  if (win === 'pm') {
    const amPool = lines.filter((l) => !l.when || l.when === 'am');
    if (amPool.length) {
      const amPick = scheduledPick(amPool, 'am', day);
      if (amPick && pick && amPick.text === pick.text) {
        return scheduledPick(pool, win, day, Math.floor(pool.length / 2));
      }
    }
  }
  return pick;
}
