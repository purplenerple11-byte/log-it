// Log It — daily line: mantras, prompts, and quotes for the #hint slot.
// Pure data + pure selection. index.html renders it; tests.js asserts on it.
//
// Entry shape: { text, when?, author? }
//   when:   'am' (shown before 5pm), 'pm' (5pm on), absent = either window
//   author: attribution line for quotes; absent for mantras/prompts

const DAILY_LINES = [
  // seed set (voice-checked with the user); full list lands in a later task
  { text: 'Begin again.' },
  { text: 'Slow is smooth. Smooth is fast.' },
  { text: 'Do the boring maintenance now.' },
  { text: 'Small rows add up.' },
  { text: 'Done counts.', when: 'pm' },
  { text: 'What are you putting off that takes five minutes?', when: 'am' },
  { text: 'What did today actually cost you?', when: 'pm' },
  { text: 'What went better than you expected?', when: 'pm' },
  { text: 'What would you skip tomorrow if nobody noticed?', when: 'pm' },
  { text: "What's the one thing worth writing down today?", when: 'am' },
  { text: 'You could leave life right now. Let that determine what you do and say and think.', author: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard', when: 'pm' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', author: 'proverb', when: 'am' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
];

// 5pm split: 'am' = midnight-4:59pm (get the day started),
// 'pm' = 5pm-midnight (look back at it). Local time, like the Today view.
function windowFor(date) {
  return date.getHours() < 17 ? 'am' : 'pm';
}

// djb2-xor, unsigned. Hash (not dayOfYear % n) so the same calendar date
// lands differently each year and consecutive days don't walk the list.
function dailyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function lineFor(date, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const win = windowFor(date);
  const pool = lines.filter((l) => !l.when || l.when === win);
  if (pool.length === 0) return null;
  const key = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + '-' + win;
  return pool[dailyHash(key) % pool.length];
}
