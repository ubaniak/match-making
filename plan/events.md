# What happens during an event

This page describes an event from creation to Done: who can do what at each stage, and the rules
the app enforces. It was agreed with Bhavek on 2026-10-31. Items marked **Later** are agreed
ideas that aren't part of the first build.

## Roles

| Role | Who | Scope |
|------|-----|-------|
| Site Admin | Users with the site `admin` role. They can do everything on the site. | Every event and club |
| Event Owner | One user per event, assigned by a site Admin | Their event |
| Club owner | Users a site Admin assigns to a club | Their club's athletes |
| Chief Official (CO) and Deputy | Chosen from the event's officials; every event needs one of each | Their event |
| Event official | An official who accepted the event's invitation | Their event |
| Viewer | Anyone added as a viewer, and the public | Public page only |

There is no event-level Admin: the `admin` role on event members (PR #8) goes away, and only
site Admins have admin powers. Athletes don't log in; their club owner acts for them.

## 1. Event setup

Event statuses are **Requested**, **Active**, **Done** and **Cancelled**.

1. Only a site Admin can create an event. Regular users can no longer create events (this
   replaces the "any user creates an event" behaviour from PR #8 and PR #13).
2. To create an event the Admin enters a name, start date, end date and Owner. The event starts as
   **Requested**.
3. The Owner is emailed "You have Requested an event" with a link to the site.
4. The Owner can upload a poster (optional) and fills in the day times (below). These stay editable.
5. A site Admin approves the event, turning it **Active**. They can approve at any time, even
   before the times are filled in. Only Active events can invite clubs, coaches or officials.
6. Only a site Admin can cancel an event, at any stage before Done. The Owner can ask the Admin
   to cancel but can't do it themselves.
7. An event becomes **Done** automatically the day after its end date. A site Admin can also mark
   it Done early.

### Inviting officials

Agreed with Bhavek on 2026-11-01.

- Once the event is **Active**, the Owner or a site Admin invites officials. Anyone on the
  Officials list (Admin page) with an email can be invited; one who has never signed in gets a
  sign-in invite as well. Each invitation is emailed, with a ready-made email to send by hand if
  the automatic one can't go out.
- An invitation can have an optional **respond by** date. After it, an unanswered invitation
  shows as **No response** and can't be accepted until the Owner re-invites.
- The official accepts or declines from the Events page. They can change their answer until the
  event's first day.
- The Owner can re-invite an official who declined or didn't respond, and can cancel an
  invitation or remove an official at any time.
- The event shows how many officials accepted, declined and haven't answered, with a list of each.
  The Owner, site Admins, the Chief Official and the Deputy see the lists; any other official sees
  only their own invitation.
- The Chief Official and Deputy are chosen from the officials who accepted. An official who
  declines or is removed stops being CO or Deputy.
- Every official who accepted can record the weigh-in (section 5).
- Officials can't ask to join an event: every official must be invited.

### Day times

- Times are set per day. A multi-day event has times for each day.
- Every day with bouts has exactly one weigh-in and one or more bout sessions (for example an
  afternoon and an evening session). A weigh-in never covers another day.
- A weigh-in has a start and end time and lasts at least 2 hours.
- The weigh-in must end at least 3 hours before that day's first bout.
- The app refuses to save times that break these rules.

### Public page

A public link, with no sign-in, lists upcoming Active events. Each event shows its name, dates,
location, poster, daily weigh-in and bout times, and (**Later**) the approved bout list. Athletes
are shown by category only; weight and date of birth are never shown publicly. Entered clubs and
athletes are not listed. Viewers see only what is on the public page.

## 2. Clubs

- A club is its own record with its own athletes. It replaces the free-text club on athletes.
- A site Admin creates clubs and assigns their club owners.
- Club owners or a site Admin add and edit the club's athletes.
- Club owners can invite more people to the club, but a site Admin must approve each invite.
- One person can belong to many clubs.

### Transfers

- An athlete belongs to one club at a time.
- To move an athlete, their coach sends a transfer request to the other club's owner, who accepts
  or declines. A site Admin can also move an athlete directly.
- Everything moves with the athlete: bout count, results and history.
- An athlete can't be transferred during an event: from when they are entered in an Active event
  until that event is Done. A site Admin can override this.

## 3. Entries

- The event Owner (or a site Admin) invites clubs to the event.
- A club owner can also request to join an Active event on the club's behalf. The Owner or a
  site Admin accepts or declines.
- Once a club is in, its club owners submit their own athletes. Athletes are entered straight
  away, with no approval, and don't have to fit any category.
- A club owner can suggest an opponent for their athlete by name and club.
- A club owner can withdraw an athlete at any time. Any bouts they were in are cancelled and the
  Owner can match a new bout.
- **Entry deadline:** the Owner chooses whether the event has one. After it passes, entries are
  locked; a club can still send the Owner a late-entry request.

## 4. Matching bouts

- The event Owner pairs athletes into bouts.
- Each bout needs:
  - approval from **both** corners' coaches, and
  - approval from **one** of the Chief Official or Deputy.
- If anyone rejects a bout, it goes back to the Owner to re-match.
- Everyone involved in a bout can comment on the match-up. Comments are plain text only.

### Match rules

The age, weight and experience allowances are in `plan/categories.md` ("Matching rules"). The app
applies them like this:

- **Hard block:** male against female, and any pairing outside the age, weight or experience
  allowances. The Owner can't save the bout.
- **Exception:** U17 against U19 is allowed only once the CO or Deputy approves it.
- A U13 can box a U15 born within 24 months of them, but can't be entered as a U15 (the same goes
  for U15 against U17).
- When two athletes are in different weight classes, the lighter boxer's band sets the allowed
  weight difference.
- Inside the limits, the app still shows the gaps (for example "Novice vs Open, 4 bouts apart")
  as warnings, so coaches and officials see them before approving.

## 5. Weigh-in and medicals

- On weigh-in day, any official who accepted the event's invitation (including the CO and Deputy)
  records each athlete's actual weight and a medical **pass** or **fail** with a note.
- Every bout is checked again against the actual weights. A bout that fails is cancelled and
  pulled off the card. An athlete who fails the medical or doesn't show up comes off their bouts
  the same way.
- After the weigh-in, only an official can make a new bout. It still needs both coaches'
  approval, but an official can override that.
- An athlete can box on more than one day of an event, and weighs in on each day they box.

## 6. The card and results

- The Owner sets the bout order and the session each bout is in.
- The card is never locked; it stays editable until the event is Done.
- The CO or Deputy records each result: winner, method (points, RSC, walkover, DQ and so on) and
  a note.
- A recorded result adds one to both boxers' bout counts, which can move a boxer from Novice to
  Open.

## Who can do what

| Action | Site Admin | Owner | Club owner | CO / Deputy | Event official |
|--------|:-:|:-:|:-:|:-:|:-:|
| Create, approve, cancel, close event | ✓ | | | | |
| Edit details, times, poster | ✓ | ✓ | | | |
| Invite officials; choose CO and Deputy | ✓ | ✓ | | | |
| Accept or decline an invitation | | | | ✓ | ✓ |
| Invite clubs, accept join and late-entry requests | ✓ | ✓ | | | |
| Submit, withdraw own athletes; suggest opponents | ✓ | | ✓ | | |
| Match bouts, set order | ✓ | ✓ | | | |
| Approve or reject a bout as coach | ✓ | | ✓ (own athletes) | | |
| Official approval; unlock U17 v U19 | ✓ | | | ✓ | |
| Record weights and medicals | ✓ | | | ✓ | ✓ |
| Re-match after weigh-in; override coach approval | ✓ | | | ✓ | |
| Record results | ✓ | | | ✓ | |
| Comment on a match-up | ✓ | ✓ | ✓ | ✓ | |

A site Admin can do anything on the site, including every action above.

## Later

- Assigning referees and judges to bouts.
- Tournament mode (brackets across days).
- Showing the approved bout list on the public page.
- Inviting people to events other than as Owner.
