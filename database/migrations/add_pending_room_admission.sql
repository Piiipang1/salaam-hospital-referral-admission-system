ALTER TABLE admissions MODIFY COLUMN room_id INT UNSIGNED NULL;
ALTER TABLE admissions MODIFY COLUMN status ENUM('Pending Room','Active','Discharged') NOT NULL DEFAULT 'Pending Room';
