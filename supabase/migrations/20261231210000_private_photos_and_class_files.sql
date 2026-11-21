-- Member and child photos (member-photos) and class files
-- (lesson-attachments: teachers' handouts and homework handed in before
-- homework got its own private bucket) are no longer public. Pages now
-- show them through server-signed app links that expire
-- (utils/signedFileUrl.js, routes/signed-files.js). Old public links to
-- these files stop working as soon as this runs.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = false where id in ('member-photos', 'lesson-attachments');
  end if;
end $$;
