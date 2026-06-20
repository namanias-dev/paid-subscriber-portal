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
-- (In DEMO MODE the login uses DEMO_ADMIN_USERNAME / DEMO_ADMIN_PASSWORD env vars instead.)
insert into public.admin_users (id, username, password_hash, role)
values
  ('a1111111-1111-1111-1111-111111111111','namanadmin',
   '$2a$10$6Qms7W0pQtqDQp/LKAlw1uHWjA1LKCs3FYZrMJGbLWjeDLfotK5JC','Super Admin')
on conflict (id) do nothing;

-- ============================================================
-- LMS + CRM seed (mirrors lib/mockData.ts)
-- ============================================================

-- ------------------------------ courses -----------------------------
insert into public.courses (id, slug, title, category, description, modes, language, target_years, duration, price, original_price, emi_amount, emi_months, faculty, status, featured, included, not_included, curriculum, schedule)
values
  ('co-safalta','safalta-online-foundation','Safalta Online Foundation 2027/28/29','Foundation','Complete GS foundation for first-timers, fully online with live + recorded support.','["Online"]','Hinglish (Bilingual)','2027/28/29','18 months',40000,50000,4000,10,'Naman Sir','published',true,'["Live + recorded lectures","Class notes (PDF)","Doubt support","Mobile & web access"]','["Printed material"]','[]','Mon–Sat, 7:00–9:00 AM IST'),
  ('co-saarthi-off','saarthi-gs-foundation-offline','Saarthi GS Foundation (Offline Chandigarh)','Foundation','Flagship classroom foundation program at our Chandigarh Sector 17C centre.','["Offline"]','Hinglish (Bilingual)','2027/28','18 months',75000,null,null,null,'Naman Sir & Core Faculty','published',true,'["Classroom lectures","Printed material","Doubt support"]','["Online recordings"]','[]','Mon–Sat, Chandigarh 17C'),
  ('co-saarthi-on','saarthi-gs-foundation-online','Saarthi GS Foundation (Online)','Foundation','The Saarthi foundation experience, delivered live online across India.','["Online"]','Hinglish (Bilingual)','2027/28','18 months',40000,null,null,null,'Naman Sir','published',false,'["Live lectures","Notes","Doubt support"]','["Printed material"]','[]','Mon–Sat, 7:00–9:00 AM IST'),
  ('co-digital-saarthi','digital-saarthi','Digital Saarthi','Foundation','Self-paced digital foundation with structured drip release.','["Online","Recorded"]','Hinglish (Bilingual)','2027/28','18 months',40000,null,null,null,'Naman Sir','published',false,'["Recorded lectures","Notes"]','["Live doubt sessions"]','[]','Self-paced'),
  ('co-ncert','ncert-foundation','NCERT Foundation','Specialist','Build rock-solid basics through complete NCERT coverage.','["Online","Hybrid"]','Hinglish (Bilingual)','2027/28','3 months',7500,null,null,null,'Naman Sir','published',false,'["NCERT lectures","Notes"]','[]','[]','Flexible'),
  ('co-pubad','public-administration-optional','Public Administration Optional 2026','Optional','Comprehensive Pub Ad optional coverage with answer writing.','["Offline","Online"]','Hinglish (Bilingual)','2026','10 months',45000,null,null,null,'Naman Sir','published',false,'["Full syllabus","Answer writing"]','[]','[]','Weekends'),
  ('co-psir','psir-optional','PSIR Optional 2026','Optional','Political Science & IR optional, full syllabus + test series.','["Online"]','Hinglish (Bilingual)','2026','10 months',40000,60000,null,null,'Naman Sir','published',false,'["Full syllabus","Test series"]','[]','[]','Weekends'),
  ('co-ethics','ethics-governance-mains','Ethics & Governance (Mains 2026/27)','Mains','GS4 Ethics mastery with case studies and model answers.','["Online"]','Hinglish (Bilingual)','2026/27','2 months',10000,20000,null,null,'Naman Sir','published',false,'["Case studies","Model answers"]','[]','[]','Mon/Wed/Fri'),
  ('co-mentorship','exclusive-mentorship-naman-sir','Exclusive Mentorship by Naman Sir','Mentorship','Personal 1:1 mentorship, study plan, and weekly reviews with Naman Sir.','["Online"]','Hinglish (Bilingual)','2026','6 months',15000,30000,null,null,'Naman Sir','published',true,'["1:1 mentorship","Weekly reviews","Study plan"]','[]','[]','Weekly'),
  ('co-mains-ts','upsc-mains-test-series-2026','UPSC Mains Test Series 2026','Test Series','Full-length GS + Essay mains tests with evaluation.','["Online"]','Hinglish (Bilingual)','2026','Full cycle',12000,15000,null,null,'Naman Sir','published',false,'["GS + Essay tests","Evaluation"]','[]','[]','Scheduled'),
  ('co-pubad-ts','pubad-optional-test-series-2026','Pub Ad Optional Test Series 2026','Test Series','Sectional + full tests for Public Administration optional.','["Online"]','Hinglish (Bilingual)','2026','Full cycle',7000,10000,null,null,'Naman Sir','published',false,'["Sectional tests","Full tests"]','[]','[]','Scheduled'),
  ('co-maps','upsc-through-maps-prelims-2026','UPSC Through Maps (Prelims 2026)','Specialist','Master geography & mapping for Prelims through visual learning.','["Recorded"]','Hinglish (Bilingual)','2026','Recorded',1000,10000,null,null,'Naman Sir','published',false,'["Recorded lectures","Map sets"]','[]','[]','Self-paced'),
  ('co-masterclass','beginner-upsc-masterclass','Beginner UPSC Masterclass','Entry','Rs.50 beginner masterclass — the perfect first step into UPSC.','["Online"]','Hinglish (Bilingual)','2027','2 hours',50,500,null,null,'Naman Sir','published',false,'["Strategy session"]','[]','[]','Scheduled'),
  ('co-demo','one-week-upsc-demo','1-Week UPSC Demo','Entry','Experience our teaching for a full week before you commit.','["Online","Offline"]','Hinglish (Bilingual)','2027','1 week',500,1000,null,null,'Naman Sir','published',false,'["1 week of classes"]','[]','[]','Daily'),
  ('co-pcs-ts','punjab-pcs-prelims-test-series','Punjab PCS Prelims Test Series','PCS','Targeted Punjab PCS prelims practice with state-specific focus.','["Online","Offline"]','Hinglish (Bilingual)','2026','Full cycle',2000,null,null,null,'Naman Sir','published',false,'["Prelims tests"]','[]','[]','Scheduled'),
  ('co-pcs-weekend','punjab-pcs-weekend-batch','Punjab PCS Weekend Batch','PCS','Weekend classroom batch for working aspirants — Punjab PCS.','["Offline"]','Hinglish (Bilingual)','2026','6 months',10000,null,null,null,'Naman Sir','published',false,'["Weekend classes"]','[]','[]','Weekends'),
  ('co-hcs','hcs-crash-course','HCS Crash Course','PCS','Fast-track crash course for Haryana Civil Services.','["Online","Offline"]','Hinglish (Bilingual)','2026','3 months',10000,null,null,null,'Naman Sir','published',false,'["Crash lectures"]','[]','[]','Daily'),
  ('co-counselling','free-counselling','Free Counselling','Entry','Free one-on-one counselling to plan your UPSC journey.','["Online"]','Hinglish (Bilingual)','2027','30 min call',0,null,null,null,'Naman Sir','published',false,'["1:1 counselling"]','[]','[]','By appointment')
on conflict (id) do nothing;

-- ------------------------------ webinars ----------------------------
insert into public.webinars (id, slug, title, description, datetime, link, price, capacity, registrations, recording_link, status)
values
  ('web-masterclass','beginner-upsc-masterclass','Rs.50 Beginner UPSC Masterclass','A 2-hour masterclass to kickstart your UPSC journey with the right strategy.', now() + interval '3 days','https://www.youtube.com/watch?v=placeholder',50,1000,412,null,'upcoming'),
  ('web-optional','how-to-choose-optional','How to Choose Your Optional Subject','Free webinar on selecting the right optional for maximum scoring.', now() + interval '7 days','https://www.youtube.com/watch?v=placeholder',0,2000,873,null,'upcoming'),
  ('web-prelims','prelims-2026-strategy','Prelims 2026 — 90 Day Strategy','Recording of our most-watched prelims strategy seminar.', now() - interval '12 days',null,0,null,1540,'https://www.youtube.com/watch?v=dQw4w9WgXcQ','completed')
on conflict (id) do nothing;

-- ------------------------------- plans ------------------------------
insert into public.plans (id, name, months, price, features)
values
  ('1m','1 Month',1,299,'["Daily CA","Daily MCQs","Booklets","PYQ Bank"]'),
  ('3m','3 Months',3,799,'["Everything in 1M","Answer Writing","Live + Recordings","Test Series"]'),
  ('6m','6 Months',6,1499,'["Everything in 3M","Prelims + Mains","Priority support"]'),
  ('12m','12 Months',12,2499,'["Everything in 6M","Full-year mentorship","All cohorts"]'),
  ('lifetime','Lifetime',null,3999,'["Everything forever","All future content","Lifetime community"]')
on conflict (id) do nothing;

-- ------------------------------- staff ------------------------------
insert into public.staff (id, name, username, role, email, active)
values
  ('st-1','Naman Sir','namanadmin','Super Admin','admin@example.com',true),
  ('st-2','Counsellor Priya','priya','Counsellor','priya@example.com',true),
  ('st-3','Counsellor Raj','raj','Counsellor','raj@example.com',true),
  ('st-4','Content Team','content','Content Manager','content@example.com',true)
on conflict (id) do nothing;

-- ---------------------------- enrollments ---------------------------
insert into public.enrollments (id, student_id, course_id, status, fee_total, fee_collected, pending, installments, progress)
values
  ('en-0001','11111111-1111-1111-1111-111111111111','co-saarthi-on','active',40000,25000,15000,'[{"label":"Installment 1","amount":25000,"paid":true},{"label":"Installment 2","amount":15000,"paid":false}]',38),
  ('en-0002','11111111-1111-1111-1111-111111111111','co-ethics','active',10000,10000,0,'[{"label":"Full payment","amount":10000,"paid":true}]',64),
  ('en-0003','22222222-2222-2222-2222-222222222222','co-pubad','active',45000,45000,0,'[{"label":"Full payment","amount":45000,"paid":true}]',20)
on conflict (id) do nothing;

-- ------------------------------- leads ------------------------------
insert into public.leads (id, name, phone, city, state, source, campaign, course_interest, target_year, mode_pref, called, status, temperature, demo_booked, demo_attended, admitted, counsellor)
values
  ('lead-0001','Aspirant One','9000010001','Chandigarh','Punjab','Instagram','Foundation 2027 Launch','Safalta Online Foundation',2026,'Online',true,'New','Interested',false,false,false,'Counsellor Priya'),
  ('lead-0002','Aspirant Two','9000010002','Mohali','Haryana','Meta Form','Rs.50 Masterclass','PSIR Optional',2027,'Offline',true,'Contacted','Warm',false,false,false,'Counsellor Raj'),
  ('lead-0003','Aspirant Three','9000010003','Ludhiana','Himachal','Webinar','Foundation 2027 Launch','Ethics & Governance',2028,'Online',true,'Demo Booked','Interested',true,false,false,'Counsellor Priya'),
  ('lead-0004','Aspirant Four','9000010004','Amritsar','Punjab','Demo','Rs.50 Masterclass','Mains Test Series',2026,'Offline',true,'Demo Attended','Warm',true,true,false,'Counsellor Raj'),
  ('lead-0005','Aspirant Five','9000010005','Shimla','Himachal','Referral','Foundation 2027 Launch','Saarthi Foundation',2026,'Online',true,'Admitted','Interested',true,true,true,'Counsellor Priya')
on conflict (id) do nothing;

-- ------------------------------ payments ----------------------------
insert into public.payments (id, student_name, phone, item, item_type, amount, status, razorpay_payment_id, mode)
values
  ('pay-0001','Student A','9810000001','Safalta Online Foundation','course',40000,'captured','pay_demo_1001','Online'),
  ('pay-0002','Student B','9810000002','Ethics & Governance','course',10000,'captured','pay_demo_1002','Online'),
  ('pay-0003','Student C','9810000003','PSIR Optional','course',40000,'pending','pay_demo_1003','Online'),
  ('pay-0004','Student D','9810000004','UPSC Through Maps','course',1000,'captured','pay_demo_1004','Recorded'),
  ('pay-0005','Student E','9810000005','Mentorship','course',15000,'refunded','pay_demo_1005','Online')
on conflict (id) do nothing;

-- ----------------------------- referrals ----------------------------
insert into public.referrals (id, referrer_name, referrer_phone, referee_name, tier, admitted, payout_status)
values
  ('ref-1','Sneha Kapoor','9840044004','Friend One',3000,true,'paid'),
  ('ref-2','Aarav Mehta','9810011001','Friend Two',1000,true,'pending'),
  ('ref-3','Demo Student','9999999999','Friend Three',5000,false,'pending')
on conflict (id) do nothing;
