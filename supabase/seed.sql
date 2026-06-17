-- ============================================================
-- Naman Sharma IAS Academy — Seed data
-- Run AFTER schema.sql. Mirrors lib/mockData.ts so demo & live look identical.
-- Safe to re-run (uses fixed UUIDs + on conflict do nothing).
-- ============================================================

-- ----------------------------- students -----------------------------
insert into public.students
  (id, name, phone, email, plan, months, access_code, start_date, expiry_date,
   amount_paid, razorpay_payment_id, razorpay_order_id, target_year, optional_subject,
   streak_count, last_active_date, is_active)
values
  ('11111111-1111-1111-1111-111111111111','Demo Student','9999999999','demo@namaniasacademy.com',
   '3m',3,'NS-0000-DEMO', now() - interval '20 days', now() + interval '70 days',
   799,'pay_demo0001','order_demo0001',2026,'Sociology',5, current_date - 1, true),

  ('22222222-2222-2222-2222-222222222222','Aarav Mehta','9810011001','aarav@example.com',
   '12m',12,'NS-4821-AARA', now() - interval '40 days', now() + interval '325 days',
   2499,'pay_demo0002','order_demo0002',2026,'PSIR',12, current_date - 1, true),

  ('33333333-3333-3333-3333-333333333333','Ishita Rao','9820022002','ishita@example.com',
   '1m',1,'NS-7390-ISHI', now() - interval '26 days', now() + interval '4 days',
   299,'pay_demo0003','order_demo0003',2027,'Geography',3, current_date - 2, true),

  ('44444444-4444-4444-4444-444444444444','Rohan Gupta','9830033003','rohan@example.com',
   '1m',1,'NS-1567-ROHA', now() - interval '40 days', now() - interval '10 days',
   299,'pay_demo0004','order_demo0004',2026,'Sociology',0, current_date - 11, true),

  ('55555555-5555-5555-5555-555555555555','Sneha Kapoor','9840044004','sneha@example.com',
   'lifetime',null,'NS-9043-SNEH', now() - interval '120 days', null,
   3999,'pay_demo0005','order_demo0005',2026,'Anthropology',28, current_date - 1, true)
on conflict (id) do nothing;

-- --------------------------- content_items --------------------------
insert into public.content_items
  (id, type, subject, paper, title, description, drive_link, youtube_link, date, duration, is_published)
values
  ('c1111111-1111-1111-1111-111111111111','current_affairs','Polity','GS2',
   'Daily Current Affairs — Today''s Top 10',
   'Curated MoU, Supreme Court verdicts, economy headlines and international relations for today.',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_CA_today/view', null,
   current_date, '12 min read', true),

  ('c2222222-2222-2222-2222-222222222222','mcq','Economy','GS3',
   'Daily Prelims MCQs — Set 142 (Economy)',
   '10 fresh prelims-style MCQs with detailed explanations.',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_MCQ142/view', null,
   current_date, '10 questions', true),

  ('c3333333-3333-3333-3333-333333333333','booklet','Polity','GS2',
   'Indian Polity — Fundamental Rights Booklet',
   'Crisp revision booklet covering Articles 12-35 with mind-maps.',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_FRbooklet/view', null,
   current_date - 3, '48 pages', true),

  ('c4444444-4444-4444-4444-444444444444','recording','Geography','GS1',
   'Recording — Indian Monsoon Mechanism',
   'Full class recording explaining monsoon dynamics with diagrams.',
   null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   current_date - 5, '1h 24m', true),

  ('c5555555-5555-5555-5555-555555555555','live_link','Ethics','GS4',
   'Live Class — Ethics Case Studies Masterclass',
   'Join Naman Sir live for case-study answer frameworks.',
   null, 'https://www.youtube.com/watch?v=live_session_placeholder',
   current_date + 1, '8:00 PM IST', true),

  ('c6666666-6666-6666-6666-666666666666','pyq','History','GS1',
   'PYQ Bank — Modern History (2013-2024)',
   'Topic-wise previous year questions with trend analysis.',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_PYQhist/view', null,
   current_date - 7, '60 pages', true),

  ('c7777777-7777-7777-7777-777777777777','test_series','Environment','GS3',
   'Prelims Test Series — Full Test 04',
   '100-question full-length prelims test (unlocks soon).',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_FT04/view', null,
   current_date + 2, '100 questions', false),

  ('c8888888-8888-8888-8888-888888888888','answer_writing','Ethics','GS4',
   'Answer Writing — Daily Mains Question',
   'Today''s mains question with model structure (draft, unpublished).',
   'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoP_AW01/view', null,
   current_date, '1 question', false)
on conflict (id) do nothing;

-- ----------------------------- bookmarks ----------------------------
insert into public.bookmarks (id, student_id, content_id)
values
  ('b1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','c3333333-3333-3333-3333-333333333333'),
  ('b2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','c6666666-6666-6666-6666-666666666666')
on conflict (id) do nothing;

-- -------------------------- content_progress ------------------------
insert into public.content_progress (id, student_id, content_id, completed, completed_at)
values
  ('d1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','c1111111-1111-1111-1111-111111111111', true, now() - interval '1 day'),
  ('d2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','c2222222-2222-2222-2222-222222222222', true, now() - interval '2 days')
on conflict (id) do nothing;

-- ---------------------------- admin_users ---------------------------
-- Username: namanadmin  |  Password: NamanAdmin2025  (bcrypt hash below)
insert into public.admin_users (id, username, password_hash)
values
  ('a1111111-1111-1111-1111-111111111111','namanadmin',
   '$2a$10$6Qms7W0pQtqDQp/LKAlw1uHWjA1LKCs3FYZrMJGbLWjeDLfotK5JC')
on conflict (id) do nothing;
