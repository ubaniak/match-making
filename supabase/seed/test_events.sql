-- Loads the test data (two TEST events in year 3000, 5 TEST clubs, 120 TEST athletes).
-- Same as the "Load test data" button on the Admin page. Needs migration 17 (test_data).
select public.seed_test_data();
