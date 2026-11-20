BEGIN;
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  tag_id     INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE TEMP TABLE raw(contact_id INTEGER, name TEXT);
WITH RECURSIVE split(contact_id, item, rest) AS (
  SELECT id, '', COALESCE(tags, '') || ',' FROM contacts
  UNION ALL
  SELECT contact_id, lower(trim(substr(rest, 1, instr(rest, ',') - 1))), substr(rest, instr(rest, ',') + 1)
  FROM split WHERE rest <> ''
)
INSERT INTO raw SELECT contact_id, item FROM split WHERE item <> '';
INSERT INTO tags(name) SELECT DISTINCT name FROM raw ORDER BY name;
INSERT INTO contact_tags SELECT DISTINCT r.contact_id, t.id FROM raw r JOIN tags t ON t.name = r.name;
DROP TABLE raw;
ALTER TABLE contacts DROP COLUMN tags;
COMMIT;
