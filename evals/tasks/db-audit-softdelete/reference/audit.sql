CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  op         TEXT NOT NULL,
  row_id     INTEGER NOT NULL,
  old_values TEXT,
  new_values TEXT,
  changed    TEXT
);

CREATE UNIQUE INDEX accounts_email_active ON accounts (email COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TRIGGER accounts_ai AFTER INSERT ON accounts
BEGIN
  UPDATE accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  INSERT INTO audit_log (op, row_id, old_values, new_values, changed)
  SELECT 'INSERT', id, NULL,
         json_object('id', id, 'email', email, 'name', name, 'deleted_at', deleted_at, 'updated_at', updated_at),
         NULL
  FROM accounts WHERE id = NEW.id;
END;

CREATE TRIGGER accounts_au AFTER UPDATE OF email, name, deleted_at ON accounts
WHEN OLD.email IS NOT NEW.email OR OLD.name IS NOT NEW.name OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  UPDATE accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  INSERT INTO audit_log (op, row_id, old_values, new_values, changed)
  SELECT 'UPDATE', NEW.id,
         json_object('id', OLD.id, 'email', OLD.email, 'name', OLD.name, 'deleted_at', OLD.deleted_at, 'updated_at', OLD.updated_at),
         json_object('id', id, 'email', email, 'name', name, 'deleted_at', deleted_at, 'updated_at', updated_at),
         (SELECT json_group_array(c) FROM (
            SELECT 'email' AS c WHERE OLD.email IS NOT NEW.email
            UNION ALL SELECT 'name' WHERE OLD.name IS NOT NEW.name
            UNION ALL SELECT 'deleted_at' WHERE OLD.deleted_at IS NOT NEW.deleted_at))
  FROM accounts WHERE id = NEW.id;
END;

CREATE TRIGGER accounts_ad AFTER DELETE ON accounts
BEGIN
  INSERT INTO audit_log (op, row_id, old_values, new_values, changed)
  VALUES ('DELETE', OLD.id,
          json_object('id', OLD.id, 'email', OLD.email, 'name', OLD.name, 'deleted_at', OLD.deleted_at, 'updated_at', OLD.updated_at),
          NULL, NULL);
END;

CREATE VIEW active_accounts AS
  SELECT id, email, name, updated_at FROM accounts WHERE deleted_at IS NULL;

CREATE TRIGGER active_accounts_del INSTEAD OF DELETE ON active_accounts
BEGIN
  UPDATE accounts SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = OLD.id AND deleted_at IS NULL;
END;
