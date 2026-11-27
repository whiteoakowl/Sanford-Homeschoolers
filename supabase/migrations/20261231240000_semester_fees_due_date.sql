-- A real request: "Add/edit semester. Be able to add a due date for all
-- fees charged for classes that are linked to that semester." Class
-- registration charges for a class in this semester get this due date;
-- the student stays registered whether or not it's paid yet.
alter table semesters add column if not exists fees_due_date text;
