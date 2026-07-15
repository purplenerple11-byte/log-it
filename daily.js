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

function lineFor(date, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const win = windowFor(date);
  const pool = lines.filter((l) => !l.when || l.when === win);
  if (pool.length === 0) return null;
  const key = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + '-' + win;
  return pool[dailyHash(key) % pool.length];
}
