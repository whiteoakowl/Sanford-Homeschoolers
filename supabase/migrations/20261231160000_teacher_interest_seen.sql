-- Co-op Admin homepage Pending Requests counts Teacher Interest Form
-- submissions an admin hasn't opened yet (set when the log page is viewed).
alter table teacher_interest_submissions add column if not exists seen_at text;
