-- Removes everything with a "TEST " name prefix: events (with their entries and bouts),
-- athletes and clubs. Same as the "Clear test data" button on the Admin page. Needs migration 17.
select public.clear_test_data();
