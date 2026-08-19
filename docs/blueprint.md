# Number Guessing Game Bot — Bot specification

**Archetype:** community

**Voice:** fun and encouraging — write every user-facing message, button label, error, and empty state in this voice.

A Telegram group bot that facilitates a number-guessing game where the admin starts a round, members submit guesses, and the bot provides public hints until someone wins. The bot tracks game history and maintains a leaderboard of top winners.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group admins
- Group members seeking casual entertainment

## Success criteria

- Admins can start and restart game rounds
- Members receive public hints for their guesses
- Winners are announced and tracked in a leaderboard

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **/startgame** (command, actor: admin, command: /startgame) — Start a new game round or force restart if used with 'force' parameter
- **/scoreboard** (command, actor: user, command: /scoreboard) — Display the top 10 winners leaderboard
- **/gameresult** (command, actor: user, command: /gameresult) — Repeat the last round's result

## Flows

### Start Game
_Trigger:_ /startgame

1. Admin issues /startgame command
2. Bot generates secret number between 1-100
3. Bot announces new game round in group
4. Bot waits for guesses

_Data touched:_ Game round

### Submit Guess
_Trigger:_ numeric message

1. User sends numeric message
2. Bot validates guess format
3. Bot compares guess to secret number
4. Bot sends public hint (higher/lower/correct)

_Data touched:_ Player guess

### Declare Winner
_Trigger:_ correct guess

1. User guesses correctly
2. Bot announces winner in group
3. Bot records round result
4. Bot closes current round

_Data touched:_ Game round, Player guess

### Force Restart
_Trigger:_ /startgame force

1. Admin issues /startgame force
2. Bot cancels current round
3. Bot starts new game round

_Data touched:_ Game round

### View Scoreboard
_Trigger:_ /scoreboard

1. User issues /scoreboard
2. Bot retrieves top 10 winners
3. Bot displays leaderboard

_Data touched:_ Leaderboard

### View Game Result
_Trigger:_ /gameresult

1. User issues /gameresult
2. Bot retrieves last round result
3. Bot displays winner and game details

_Data touched:_ Game round

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Game round** _(retention: persistent)_ — Active and historical game rounds with secret numbers and results
  - fields: secret_number, started_by, active, start_time, end_time, winner
- **Player guess** _(retention: persistent)_ — Individual player guesses with timestamps
  - fields: user_id, username, guess_value, timestamp
- **Leaderboard** _(retention: persistent)_ — User win counts for the session
  - fields: user_id, username, win_count, last_win_time

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Start game rounds
- Force restart rounds
- View game history and leaderboard

## Notifications

- Public game announcements in group chat
- Guess feedback in group chat
- Winner announcements in group chat

## Permissions & privacy

- Only group admins can start new rounds
- All guesses are visible to the group
- Usernames are stored for leaderboard tracking

## Edge cases

- Admin attempts to start a new round while one is active
- Multiple users guess the correct number simultaneously
- Non-numeric messages sent during active round

## Required tests

- Verify admin can start and force restart game rounds
- Test numeric guess validation and hint generation
- Validate winner announcement and leaderboard updates
- Confirm game state persistence after bot restart

## Assumptions

- Secret number range is always 1-100
- Guesses are any integer messages sent in group chat
- Admins are identified by Telegram chat administrators
- Bot messages use Russian by default
