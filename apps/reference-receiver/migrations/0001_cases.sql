-- One row per verification session delivered by the gateway.
CREATE TABLE cases (
  session_id TEXT PRIMARY KEY,
  reference TEXT,
  status TEXT,
  received_at TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  event_json TEXT NOT NULL
);
CREATE INDEX cases_delivered_at ON cases (delivered_at DESC);
