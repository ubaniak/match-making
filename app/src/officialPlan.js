// The officials assignment plan for one night of bouts (migration 47).
//
// Bhavek's rules (2026-11-04):
//   * Every bout has exactly 1 Referee and 1 Supervisor.
//   * Fewer than 5 officials working the night: the bouts can't go ahead (the event is cancelled).
//   * Exactly 5: 1 Supervisor, 1 Referee and 3 Judges, aiming for 2 high-level and 1 low-level judge.
//   * More than 5: aim for 5 Judges (3 high-level, 2 low-level), 1 Referee, 1 Supervisor, then a
//     Timekeeper if someone is left who can do it; everyone else rests. A Referee rests the next bout.
//   * Officials only get roles they ticked when they accepted the event. Higher levels are favoured;
//     equal levels are picked at random. Judges, Referees and Timekeepers are randomised within the
//     rules. The Supervisor is strict: only people who ticked Supervisor, never random, and the same
//     person all night while they can do it.
//   * The Chief Officials approve the plan and can change any of it by hand.

export const MIN_OFFICIALS_TO_RUN = 5

// The roles in a plan, in the order they are shown.
export const planRoles = [
  { key: 'supervisor', label: 'Supervisor', short: 'S' },
  { key: 'referee', label: 'Referee', short: 'R' },
  { key: 'judge', label: 'Judge', short: 'J' },
  { key: 'timekeeper', label: 'Timekeeper', short: 'T' },
  { key: 'rest', label: 'Rest', short: '–' },
]
export const planRoleLabel = Object.fromEntries(planRoles.map((r) => [r.key, r.label]))

// Level 3 and 4 count as high level; 1, 2 or no level count as low.
export const HIGH_LEVEL = 3
export const isHighLevel = (official) => (official.level ?? 0) >= HIGH_LEVEL

// Bouts that need officials: everything on the night's card that isn't cancelled or rejected.
export const plannedBouts = (bouts, day) =>
  bouts.filter((b) => b.day === day && !['cancelled', 'rejected'].includes(b.status))
    .sort((a, b) => a.position - b.position)

const byName = (a, b) => (a.name || '').localeCompare(b.name || '')

// pool: [{ user_id, name, level, judge, referee, supervisor, timekeeper }], the officials working
// the night. bouts: the night's bouts in card order. random: () => [0, 1), for tests.
// Returns { [boutId]: { [userId]: role } } with every official on every bout (rest when not working).
export function generatePlan(pool, bouts, random = Math.random) {
  const plan = {}
  if (pool.length < MIN_OFFICIALS_TO_RUN) return plan
  const restAfterRef = pool.length > MIN_OFFICIALS_TO_RUN
  const counts = Object.fromEntries(pool.map((o) => [o.user_id, { judge: 0, referee: 0, timekeeper: 0, rest: 0, supervisor: 0 }]))
  // A fresh random number per official per pick breaks ties fairly.
  const shuffleKey = () => Object.fromEntries(pool.map((o) => [o.user_id, random()]))
  let prevReferee = null
  let prevSupervisor = null

  for (const bout of bouts) {
    const row = {}
    const tie = shuffleKey()
    const free = new Set(pool.filter((o) => !(restAfterRef && o.user_id === prevReferee)).map((o) => o.user_id))
    const freeWith = (role) => pool.filter((o) => free.has(o.user_id) && o[role])
    const take = (official, role) => {
      row[official.user_id] = role
      counts[official.user_id][role] += 1
      free.delete(official.user_id)
    }

    // Supervisor: strict. Last bout's Supervisor stays on; otherwise the highest level, then by name.
    // Skip someone who is the only possible Referee when another Supervisor can step in.
    const supervisors = freeWith('supervisor').sort((a, b) =>
      (b.user_id === prevSupervisor) - (a.user_id === prevSupervisor) || (b.level ?? 0) - (a.level ?? 0) || byName(a, b))
    const leavesReferee = (s) => freeWith('referee').some((o) => o.user_id !== s.user_id)
    const supervisor = supervisors.find(leavesReferee) ?? supervisors[0]
    if (supervisor) take(supervisor, 'supervisor')

    // Referee: whoever has refereed least, avoiding back-to-back, then the higher level, then random.
    const referee = freeWith('referee').sort((a, b) =>
      counts[a.user_id].referee - counts[b.user_id].referee
      || (a.user_id === prevReferee) - (b.user_id === prevReferee)
      || (b.level ?? 0) - (a.level ?? 0)
      || tie[a.user_id] - tie[b.user_id])[0]
    if (referee) take(referee, 'referee')

    // Judges: 5 when more than 5 officials and enough can judge, otherwise 3.
    const judges = freeWith('judge')
    const wanted = restAfterRef && judges.length >= 5 ? 5 : Math.min(3, judges.length)
    const highWanted = wanted === 5 ? 3 : 2
    // Within a group: fewest bouts judged first, so everyone gets a turn, then higher level, then random.
    const order = (a, b) => counts[a.user_id].judge - counts[b.user_id].judge
      || (b.level ?? 0) - (a.level ?? 0)
      || tie[a.user_id] - tie[b.user_id]
    const high = judges.filter(isHighLevel).sort(order)
    const low = judges.filter((o) => !isHighLevel(o)).sort(order)
    const picked = [...high.slice(0, highWanted), ...low.slice(0, wanted - highWanted)]
    // Short of high or low judges: fill from whoever is left, higher levels first.
    const rest = judges.filter((o) => !picked.includes(o)).sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || order(a, b))
    for (const o of [...picked, ...rest].slice(0, wanted)) take(o, 'judge')

    // Timekeeper: only once 5 judges are in place, from whoever is left who can do it.
    if (wanted === 5) {
      const keeper = freeWith('timekeeper').sort((a, b) =>
        counts[a.user_id].timekeeper - counts[b.user_id].timekeeper || tie[a.user_id] - tie[b.user_id])[0]
      if (keeper) take(keeper, 'timekeeper')
    }

    for (const o of pool) if (!row[o.user_id]) { row[o.user_id] = 'rest'; counts[o.user_id].rest += 1 }
    plan[bout.id] = row
    prevReferee = referee?.user_id ?? null
    prevSupervisor = supervisor?.user_id ?? prevSupervisor
  }
  return plan
}

// What's wrong with one bout's assignments. Each problem is { text, blocking }: blocking problems
// stop the plan being approved; the rest are warnings the Chief Officials can accept.
export function boutProblems(row, pool, prevRow) {
  const problems = []
  const holders = (role) => pool.filter((o) => row?.[o.user_id] === role)
  const refs = holders('referee')
  const sups = holders('supervisor')
  const judges = holders('judge')
  if (refs.length !== 1) problems.push({ text: refs.length ? `${refs.length} referees (needs 1)` : 'No referee', blocking: true })
  if (sups.length !== 1) problems.push({ text: sups.length ? `${sups.length} supervisors (needs 1)` : 'No supervisor', blocking: true })
  if (judges.length < 3) problems.push({ text: `${judges.length} judge${judges.length === 1 ? '' : 's'} (needs at least 3)`, blocking: true })
  else if (judges.length !== 3 && judges.length !== 5) problems.push({ text: `${judges.length} judges (usually 3 or 5)`, blocking: false })
  for (const o of pool) {
    const role = row?.[o.user_id]
    if (role && role !== 'rest' && !o[role]) problems.push({ text: `${o.name} didn't tick ${planRoleLabel[role]}`, blocking: false })
  }
  if (prevRow && pool.length > MIN_OFFICIALS_TO_RUN) {
    for (const o of pool) {
      if (prevRow[o.user_id] === 'referee' && row?.[o.user_id] && row[o.user_id] !== 'rest') {
        problems.push({ text: `${o.name} refereed the last bout and should rest`, blocking: false })
      }
    }
  }
  return problems
}

// How many bouts each official does in each role: { [userId]: { judge, referee, ... } }.
export function roleCounts(plan, pool) {
  const counts = Object.fromEntries(pool.map((o) => [o.user_id, Object.fromEntries(planRoles.map((r) => [r.key, 0]))]))
  for (const row of Object.values(plan)) {
    for (const [userId, role] of Object.entries(row)) if (counts[userId] && role in counts[userId]) counts[userId][role] += 1
  }
  return counts
}

// Saved rows [{ bout_id, user_id, role }] to { [boutId]: { [userId]: role } }, and back.
export function slotsToPlan(slots) {
  const plan = {}
  for (const s of slots ?? []) (plan[s.bout_id] ??= {})[s.user_id] = s.role
  return plan
}
export function planToSlots(plan, bouts, pool) {
  const ids = new Set(pool.map((o) => o.user_id))
  return bouts.flatMap((b) => Object.entries(plan[b.id] ?? {})
    .filter(([userId, role]) => ids.has(userId) && role)
    .map(([userId, role]) => ({ bout_id: b.id, user_id: userId, role })))
}
