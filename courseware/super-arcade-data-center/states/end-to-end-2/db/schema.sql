PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS players (
    player TEXT PRIMARY KEY NOT NULL CHECK(length(player) BETWEEN 1 AND 32),
    coins INTEGER NOT NULL DEFAULT 0 CHECK(typeof(coins)='integer' AND coins BETWEEN 0 AND 1000000)
);
CREATE TABLE IF NOT EXISTS ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    player TEXT NOT NULL REFERENCES players(player),
    kind TEXT NOT NULL CHECK(kind IN ('ADD','REDEEM')),
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 1000000),
    delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND ((kind='ADD' AND delta=amount) OR (kind='REDEEM' AND delta=-amount)))
);
CREATE INDEX IF NOT EXISTS ledger_player_seq ON ledger(player,seq);
CREATE TABLE IF NOT EXISTS requests (
    event_id TEXT PRIMARY KEY NOT NULL CHECK(length(event_id) BETWEEN 1 AND 32),
    fingerprint TEXT NOT NULL,
    response TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_event_id ON ledger(event_id);
