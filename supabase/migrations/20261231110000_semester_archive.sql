-- A real request: "Settings gear. Semesters. Add an archive icon to each
-- semester... All classes, rosters, class chats, and registration will be
-- archived for this semester and will not show up on ANY portals. Be able
-- to unarchive a semester. Be able to simply view anything from an
-- archived semester." Nothing is moved or deleted - archived_at being set
-- is what hides the semester (and every class/roster tagged with it) from
-- every list, picker and portal; clearing it brings everything back as it
-- was. See utils/classSchedule.js's ARCHIVED_SEMESTER_SQL.
alter table semesters add column if not exists archived_at text;
