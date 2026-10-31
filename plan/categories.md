# Athlete categories

When an athlete is entered into an event, the app works out their age group, weight class and
experience level for that event. The tables live in `app/src/categories.js`; this page records
where each rule comes from, so they can be checked and changed.

## Sources

- **World Boxing Competition Rules**, Feb 2024, v3.99
  (https://worldboxing.org/wp-content/uploads/2024/09/World-Boxing-Competition-Rules-Feb-2024-v3.99-ClEAN.pdf)
- **Boxing Canada Articles and Rules**, Jan 2025
  (https://boxingcanada.org/wp-content/uploads/2025/04/Articles-and-Rules-January-2025.pdf).
  This PDF could not be downloaded when this was written, so Boxing Canada's domestic rules are
  taken from **Boxing Ontario's Match Guidelines for Club Shows & Tournaments 2025**
  (https://boxingontario.com/wp-content/uploads/2025/07/Match-Guidelines-Club-Events-2025.pdf),
  which is written "as per Boxing Canada 2025". Check against the Boxing Canada PDF when possible.

Where Boxing Canada's domestic rules differ from World Boxing, Boxing Canada wins.

## Age groups

Age is the age the boxer turns in the calendar year of the event (World Boxing 2.1.1, and
Boxing Ontario "as per Year of Birth"). A multi-day event uses the year of its start date.

| Group   | Age    | Source |
|---------|--------|--------|
| Fun Box | 6–10   | Boxing Canada / Ontario (U13 boxers may also take part) |
| U13     | 11–12  | Boxing Canada / Ontario |
| U15     | 13–14  | World Boxing (left to national federations) |
| U17     | 15–16  | World Boxing |
| U19     | 17–18  | World Boxing |
| Elite   | 19–39  | World Boxing says 19–40; Boxing Canada starts Masters at 40 |
| Masters | 40+    | Boxing Canada / Ontario |

Under 6 shows as "Too young".

## Weight classes

A boxer is in a class when they weigh more than its lower limit and no more than its upper limit.
Classes use the athlete's current weight on their profile, not an event weigh-in.

- **U13, U15, U17 (boys and girls):** World Boxing's U17 table: 46, 48, 50, 52, 54, 57, 60, 63,
  66, 70, 75, 80, 80+ kg (lightest class starts above 44 kg). Neither source gives separate U13 or
  U15 classes, so they share it; anyone 44 kg or lighter shows as "Under 44 kg".
- **U19, Elite, Masters, men:** 50, 55, 60, 65, 70, 75, 80, 85, 90, 90+ kg (from 47 kg).
- **U19, Elite, Masters, women:** 48, 51, 54, 57, 60, 65, 70, 75, 80, 80+ kg (from 45 kg).
- **Fun Box:** no classes; boxers are matched within 3 kg.

The v3.99 rulebook prints Elite tables marked "until 31 December 2024" (men 51–92+, women 48–81+).
From 2025 World Boxing's Elite classes are the same as its U19 ones, which is what the app uses.
That date-switch is from World Boxing's 2025 championships, not from the PDF itself; confirm it
against the Boxing Canada 2025 rulebook. Masters classes are left to national federations, so they
use the Elite tables.

## Experience

| Level  | Rule |
|--------|------|
| Novice | 10 bouts or fewer. Exhibition bouts count. |
| Open   | More than 10 bouts, or upgraded early by the provincial branch. |

A Novice may be upgraded to Open early (at least 5 Novice bouts, 2 wins, no more than 2 exhibition
bouts). The app doesn't record upgrades yet; it uses the bout count only.

## Matching rules (for later)

Not used by the app yet, but recorded for match making. From Boxing Ontario 2025:

- **Age:** within a group, at most 12 months apart. U13 v U15 and U15 v U17 at most 24 months.
  U17 v U19 only with Supervisor approval. A U19 boxer in their 18th year, Open, with at least 10
  bouts may box Elite. Masters at most 10 years apart by date of birth. Fun Box at most 12 months.
- **Weight**, when not in the same class:
  - Men Elite and U19: 5 kg under 90 kg; no limit above.
  - Women Elite and U19: 3 kg under 60 kg; 5 kg from 60 to 80 kg; no limit above 80 kg.
  - U13, U15, U17: 3 kg under 54 kg; 4 kg from 54 to 66 kg; 5 kg from 66 to 80 kg; no limit above.
  - Fun Box 3 kg; Masters 5 kg.
- **Experience:** Novice v Novice at most 7 bouts apart; Novice v Open at most 5 bouts apart;
  Open v Open no limit. Fun Box at most 10 bouts apart. A Novice v Open bout uses the Novice's
  rounds.
