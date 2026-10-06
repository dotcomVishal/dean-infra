-- Dev/test fixtures only. Never load in production. Run: npm run seed:mock-users


INSERT INTO users (firebase_uid, name, email, role, department, phone) VALUES
-- The Top Brass & Admins
('mock_uid_01', 'Dr. S. K. Mehta', 'director@campus.edu', 'DIRECTOR', 'Administration', '9876543001'),
('mock_uid_02', 'Prof. K. N. Rao', 'dean.infra@campus.edu', 'DEAN', 'Administration', '9876543002'),
('mock_uid_03', 'Vikas Admin', 'sysadmin@campus.edu', 'SYSADMIN', 'Administration', '9876543003'),

-- The Superintending Engineers (SE)
('mock_uid_04', 'Rajesh Sharma', 'se.civil@campus.edu', 'SE', 'Civil', '9876543004'),
('mock_uid_05', 'Meera Reddy', 'se.electrical@campus.edu', 'SE', 'Electrical', '9876543005'),

-- The Assistant Engineers (AE)
('mock_uid_06', 'Priya Singh', 'ae.civil@campus.edu', 'AE', 'Civil', '9876543006'),
('mock_uid_07', 'Vikram Malhotra', 'ae.electrical@campus.edu', 'AE', 'Electrical', '9876543007'),
('mock_uid_08', 'Neha Gupta', 'ae.horticulture@campus.edu', 'AE', 'Horticulture', '9876543008'),

-- The Junior Engineers (JE)
('mock_uid_09', 'Amit Kumar', 'je.civil1@campus.edu', 'JE', 'Civil', '9876543009'),
('mock_uid_10', 'Suresh Menon', 'je.civil2@campus.edu', 'JE', 'Civil', '9876543010'),
('mock_uid_11', 'Rahul Desai', 'je.electrical1@campus.edu', 'JE', 'Electrical', '9876543011'),
('mock_uid_12', 'Kavita Reddy', 'je.electrical2@campus.edu', 'JE', 'Electrical', '9876543012'),
('mock_uid_13', 'Sneha Patel', 'je.horticulture1@campus.edu', 'JE', 'Horticulture', '9876543013'),
('mock_uid_14', 'Arjun Das', 'je.horticulture2@campus.edu', 'JE', 'Horticulture', '9876543014'),

-- Clerical & Account Staff
('mock_uid_15', 'Jyoti Singh', 'accountant1@campus.edu', 'ACCOUNTANT', 'Administration', '9876543015'),
('mock_uid_16', 'Ramesh Kumar', 'accountant2@campus.edu', 'ACCOUNTANT', 'Administration', '9876543016'),
('mock_uid_17', 'Pooja Sharma', 'clerical1@campus.edu', 'CLERICAL', 'Administration', '9876543017'),
('mock_uid_18', 'Anil Kapoor', 'clerical2@campus.edu', 'CLERICAL', 'Administration', '9876543018'),

-- General Applicants
('mock_uid_19', 'Rohan Verma', 'applicant1@campus.edu', 'APPLICANT', 'General', '9876543019'),
('mock_uid_20', 'Aditi Rao', 'applicant2@campus.edu', 'APPLICANT', 'General', '9876543020');
