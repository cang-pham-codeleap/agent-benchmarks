-- Schema of the v1 database (for reference).
CREATE TABLE contacts (
  id        INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email     TEXT,
  tags      TEXT  -- comma-separated, e.g. ' Friend, work ,friend,'
);
