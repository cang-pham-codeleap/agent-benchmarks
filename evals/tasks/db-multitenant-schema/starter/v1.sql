-- Schema version 1: a single-tenant document store.
-- Created with: PRAGMA foreign_keys = ON; then this file; then PRAGMA user_version = 1.

CREATE TABLE users (
  id    INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,          -- case-sensitive in v1
  name  TEXT                           -- nullable in v1
);

CREATE TABLE folders (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES folders(id),   -- NULL = root folder
  name      TEXT NOT NULL
);

CREATE TABLE documents (
  id        INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES folders(id),
  owner_id  INTEGER NOT NULL REFERENCES users(id),
  title     TEXT NOT NULL,
  body      TEXT                       -- nullable in v1
);

CREATE TABLE shares (
  folder_id INTEGER NOT NULL REFERENCES folders(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('read', 'write')),
  PRIMARY KEY (folder_id, user_id)
);

PRAGMA user_version = 1;
