CREATE TABLE tenants (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name <> '')
);

CREATE TABLE users (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email     TEXT NOT NULL COLLATE NOCASE CHECK (instr(email, '@') > 1),
  name      TEXT NOT NULL,
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)
);

CREATE TABLE folders (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  parent_id INTEGER,
  name      TEXT NOT NULL CHECK (name <> ''),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES folders(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX folders_by_parent ON folders(tenant_id, parent_id, name);

CREATE TABLE documents (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  folder_id INTEGER NOT NULL,
  owner_id  INTEGER NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_id, folder_id) REFERENCES folders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, owner_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX documents_by_folder ON documents(tenant_id, folder_id);
CREATE INDEX documents_by_owner ON documents(tenant_id, owner_id);

CREATE TABLE shares (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  folder_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  PRIMARY KEY (folder_id, user_id),
  FOREIGN KEY (tenant_id, folder_id) REFERENCES folders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX shares_by_user ON shares(tenant_id, user_id);

CREATE TRIGGER folders_no_self_parent BEFORE INSERT ON folders
WHEN NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id
BEGIN
  SELECT RAISE(ABORT, 'folder cycle');
END;

CREATE TRIGGER folders_no_cycle BEFORE UPDATE OF parent_id ON folders
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'folder cycle') WHERE EXISTS (
    SELECT 1 WHERE NEW.parent_id = NEW.id OR EXISTS (SELECT 1 FROM folders p WHERE p.id = NEW.parent_id AND p.parent_id = NEW.id)
  );
END;

CREATE TRIGGER users_tenant_immutable BEFORE UPDATE OF tenant_id ON users
WHEN NEW.tenant_id <> OLD.tenant_id
BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable'); END;

CREATE TRIGGER folders_tenant_immutable BEFORE UPDATE OF tenant_id ON folders
WHEN NEW.tenant_id <> OLD.tenant_id
BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable'); END;

CREATE TRIGGER documents_tenant_immutable BEFORE UPDATE OF tenant_id ON documents
WHEN NEW.tenant_id <> OLD.tenant_id
BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable'); END;

PRAGMA user_version = 2;
