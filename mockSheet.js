// ================================================================
// Log It — dev fixture. Loaded ONLY under ?mock=1, never in production.
//
// These are the real Track and Susans rows as of 2026-08-16, in raw
// getValues() shape. The mock does not fake a response: it runs them through
// the actual server modules (readApi.gs + trackPay.gs), so ?mock=1 exercises
// the whole read pipeline — normalizers, the pay recompute for the pre-v4.5
// rows, and duplicate detection — with no deploy and no token.
//
// Worth keeping honest: the June/early-July rows genuinely have no F-I values,
// which is what makes the "estimated" path visible here.
// ================================================================

const MOCK_TRACK_ROWS = [
  ['Timestamp', 'Hours', 'Tips', 'Hourly Rate', 'Notes',
   'Gross Wage', 'Est. Net Wage', 'Total Take-Home', 'Eff. $/hr'],
  [new Date(2026, 5, 3),             8.17,   338, '$41.39', '3 Bucks guy', '', '', '', ''],
  [new Date(2026, 5, 4, 21, 10, 55),  9.5,   352, '$37.05', '5 buck guy', '', '', '', ''],
  [new Date(2026, 5, 5, 20, 30, 53), 11.317, 602, '$53.20', '2 bucks guy', '', '', '', ''],
  [new Date(2026, 5, 6, 22, 3, 9),   12.67,  882, '$69.63', 'Belmont', '', '', '', ''],
  [new Date(2026, 5, 7, 19, 30, 49),  8.08,  382, '$47.26', 'Rainy', '', '', '', ''],
  [new Date(2026, 6, 3, 19, 33, 33),  8.83,  302, '$34.20', 'It was hot and we were down one guy', '', '', '', ''],
  [new Date(2026, 6, 4, 20, 8, 38),   9.43,  323, '$34.25', '9:46am to 7:42pm', '', '', '', ''],
  [new Date(2026, 6, 5, 19, 49, 31),  8.3,   130, '$15.66', 'Clocked in at 9:39am, clocked out at 6:31pm', '', '', '', ''],
  [new Date(2026, 6, 9, 18, 31, 36),  8.68,  235, '$27.07', 'Shift from 9:20am to 6:31pm', '', '', '', ''],
  [new Date(2026, 6, 10, 19, 36, 11), 9,     521, '$57.89', '9:30am to 7:00pm shift', '', '', '', ''],
  [new Date(2026, 6, 12, 16, 28, 18), 9.18,  306, '$33.33', '9:31am to 7:12pm', '', '', '', ''],
  [new Date(2026, 6, 13, 13, 56, 36), 9.5,   130, '$13.68', '9:30am to 7:30pm shift', '', '', '', ''],
  [new Date(2026, 6, 16, 18, 23, 38), 8.13,  334, '$41.08', 'Bad air quality day', '', '', '', ''],
  [new Date(2026, 6, 17, 21, 19, 47), 9,     501, '$55.67', '10 each for Maia', '', '', '', ''],
  [new Date(2026, 6, 18, 22, 36, 51), 9.63,  421, '$43.72', 'Very rainy day. Always bring extra clothes', '', '', '', ''],
  [new Date(2026, 6, 19, 19, 13, 1),  9.18,  236, '$25.71', '9:26am-7:07pm', '', '', '', ''],
  [new Date(2026, 6, 23, 18, 53, 54), 9.03,  350, '$38.76', 'Clocked in at 9:18am, clocked out at 6:50pm', 145.11, 132.78, 482.78, 53.46],
  [new Date(2026, 6, 24, 19, 19, 26), 9.28,  516, '$55.60', '', 149.13, 132.05, 648.05, 69.83],
  [new Date(2026, 6, 25, 21, 11, 46), 9.73,  470, '$48.30', '', 156.36, 121.17, 591.17, 60.76],
  [new Date(2026, 6, 26, 21, 0, 0),   9.27,  294, '$31.72', '', 148.97, 112.96, 406.96, 43.9],
  [new Date(2026, 6, 30, 19, 42, 35), 8.3,   340, '$40.96', 'Very busy almost full by 14:00', 133.38, 122, 462, 55.66],
  [new Date(2026, 6, 31, 19, 7, 5),   9.32,  522, '$56.01', 'Luis had a heart attack', 149.77, 133.22, 655.22, 70.3],
  [new Date(2026, 7, 1, 19, 55, 37), 10.07,  342, '$33.96', '', 161.82, 126.48, 468.48, 46.52],
  [new Date(2026, 7, 2, 19, 30, 0),   9.17,  242, '$26.39', '9:20am-7:00pm', 147.36, 111.86, 353.86, 38.59],
  [new Date(2026, 7, 5, 20, 47, 21),  8.97,  342, '$38.13', '', 144.15, 131.9, 473.9, 52.83],
  [new Date(2026, 7, 6, 19, 8, 43),   8.7,   375, '$43.10', 'It was HOT', 139.81, 124.03, 499.03, 57.36],
  [new Date(2026, 7, 7, 20, 34, 27),  9.58,  419, '$43.74', '', 153.95, 120.37, 539.37, 56.3],
  [new Date(2026, 7, 8, 21, 56, 30), 11.47,  619, '$53.97', 'Whitney day', 184.32, 139.55, 758.55, 66.13],
  [new Date(2026, 7, 9, 21, 10, 13),  9.68,  219, '$22.62', '', 155.56, 115.9, 334.9, 34.6],
  [new Date(2026, 7, 12, 19, 21, 24), 8.7,   315, '$36.21', 'Jason was there', 139.81, 127.91, 442.91, 50.91],
  [new Date(2026, 7, 13, 18, 52, 12), 8.85,  407, '$45.99', 'Pretty busy', 142.22, 126.35, 533.35, 60.27],
  [new Date(2026, 7, 14, 19, 49, 14), 9.48,  540, '$56.96', '', 152.34, 119.32, 659.32, 69.55],
  [new Date(2026, 7, 15, 20, 0, 0),   9.75,  435, '$44.62', '', 156.68, 119.02, 554.02, 56.82]
];

const MOCK_SUSANS_ROWS = [
  ['Timestamp', 'Clock In', 'Clock Out', 'Hours', 'Pay @ $20/hr', 'Notes'],
  [new Date(2026, 5, 11, 17, 35, 17), '2:35 PM', '8:30 PM', 5.42, '$108.40', 'there was an hour long rush'],
  [new Date(2026, 5, 12, 21, 5, 15),  '2:30 PM', '9:05 PM', 6.08, '$121.60', 'No Ethan'],
  [new Date(2026, 5, 13, 20, 57, 48), '2:30 PM', '9:00 PM', 6,    '$120.00', ''],
  [new Date(2026, 5, 14, 20, 22, 17), '2:45 PM', '8:20 PM', 5.08, '$101.60', ''],
  [new Date(2026, 5, 17, 20, 56, 49), '3:00 PM', '8:30 PM', 5,    '$100.00', ''],
  [new Date(2026, 5, 19, 20, 41, 40), '2:50 PM', '8:30 PM', 5.3,  '$106.00', ''],
  [new Date(2026, 5, 20, 20, 50, 11), '2:45 PM', '8:50 PM', 5.58, '$111.60', ''],
  [new Date(2026, 5, 25, 20, 44, 34), '2:50 PM', '8:45 PM', 5.42, '$108.40', ''],
  [new Date(2026, 5, 26, 20, 59, 4),  '2:50 PM', '9:00 PM', 5.67, '$113.40', 'no Ethan'],
  [new Date(2026, 5, 27, 20, 45, 46), '1:10 PM', '8:45 PM', 7.08, '$141.60', 'Long day'],
  [new Date(2026, 5, 28, 16, 46, 9),  '3:20 PM', '8:00 PM', 4.33, '$86.60',  ''],
  // The two validation logs, an hour apart. markDuplicates should flag the
  // second and leave the first alone.
  [new Date(2026, 6, 15, 7, 41, 54),  '2:00 PM', '4:00 PM', 2,    '$40.00',  ''],
  [new Date(2026, 6, 15, 8, 41, 56),  '2:00 PM', '4:00 PM', 2,    '$40.00',  '']
];

// Mirrors handleRead('shifts') exactly, using the real server functions.
function mockShiftsResponse() {
  const shifts = readTrackShifts(MOCK_TRACK_ROWS).concat(readSusansShifts(MOCK_SUSANS_ROWS));
  fillMissingPay(shifts);
  markDuplicates(shifts);
  return { success: true, fetched_at: new Date().toISOString(), shifts };
}
