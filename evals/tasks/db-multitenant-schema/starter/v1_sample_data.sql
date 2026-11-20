-- Sample rows for trying out your migration. The real databases are bigger and
-- messier: ids are not contiguous and a child folder can have a LOWER id than its parent.
INSERT INTO users VALUES (1, 'Ann@Example.com', 'Ann');
INSERT INTO users VALUES (2, 'bob@example.com', NULL);
INSERT INTO folders VALUES (1, NULL, 'root');
INSERT INTO folders VALUES (2, 1, 'reports');
INSERT INTO folders VALUES (5, 9, 'child-with-lower-id');
INSERT INTO folders VALUES (9, 2, 'parent-with-higher-id');
INSERT INTO documents VALUES (1, 5, 1, 'Q1', 'numbers');
INSERT INTO documents VALUES (2, 1, 2, 'Empty', NULL);
INSERT INTO shares VALUES (2, 2, 'read');
INSERT INTO shares VALUES (9, 1, 'write');
