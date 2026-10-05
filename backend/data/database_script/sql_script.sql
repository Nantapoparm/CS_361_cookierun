SET NAMES utf8mb4;
CREATE DATABASE cs361_compensation
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cs361_compensation;

CREATE TABLE table_types (
  tableId INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tableName VARCHAR(64) NOT NULL UNIQUE,
  description TEXT NULL
) ENGINE=InnoDB;

CREATE TABLE user_role (
  roleId INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  roleName VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE user_information (
  userId VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  lastName VARCHAR(100) NOT NULL,
  phoneNumber VARCHAR(25) NULL,
  roleId INT UNSIGNED NOT NULL,
  CONSTRAINT fk_user_role FOREIGN KEY (roleId) REFERENCES user_role(roleId)
) ENGINE=InnoDB;

CREATE TABLE `session` (
  sessionId INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sessionName VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE compensation_rates (
  sessionId INT UNSIGNED NOT NULL,
  roleId INT UNSIGNED NOT NULL,
  compensationPerHour DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (sessionId, roleId),
  CONSTRAINT fk_rate_session FOREIGN KEY (sessionId) REFERENCES `session`(sessionId),
  CONSTRAINT fk_rate_role FOREIGN KEY (roleId) REFERENCES user_role(roleId),
  CONSTRAINT ck_rate_nonnegative CHECK (compensationPerHour >= 0)
) ENGINE=InnoDB;

CREATE TABLE compensation_rules (
  ruleId INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sessionId INT UNSIGNED NOT NULL,
  roleId INT UNSIGNED NOT NULL,
  maxHoursPerTerm DECIMAL(8,2) NULL,
  maxAmountPerDay DECIMAL(10,2) NULL,
  description TEXT NULL,
  UNIQUE KEY uq_rule_rate (sessionId, roleId),
  CONSTRAINT fk_rule_rate FOREIGN KEY (sessionId, roleId)
    REFERENCES compensation_rates(sessionId, roleId),
  CONSTRAINT ck_rule_hours CHECK (maxHoursPerTerm IS NULL OR maxHoursPerTerm >= 0),
  CONSTRAINT ck_rule_amount CHECK (maxAmountPerDay IS NULL OR maxAmountPerDay >= 0)
) ENGINE=InnoDB;

CREATE TABLE courses_name (
  courseId VARCHAR(30) PRIMARY KEY,
  courseName VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE course_offerings (
  offeringId BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  courseId VARCHAR(30) NOT NULL,
  academicYear SMALLINT UNSIGNED NOT NULL,
  semester TINYINT UNSIGNED NOT NULL,
  sessionId INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_offering (courseId, academicYear, semester, sessionId),
  UNIQUE KEY uq_offering_session (offeringId, sessionId),
  CONSTRAINT fk_offering_course FOREIGN KEY (courseId) REFERENCES courses_name(courseId),
  CONSTRAINT fk_offering_session FOREIGN KEY (sessionId) REFERENCES `session`(sessionId),
  CONSTRAINT ck_offering_semester CHECK (semester BETWEEN 1 AND 3)
) ENGINE=InnoDB;

CREATE TABLE `status` (
  statusId INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  statusName VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE claims (
  claimId BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dayClaim DATETIME NULL,
  userId VARCHAR(50) NOT NULL,
  statusId INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_claim_owner (claimId, userId),
  CONSTRAINT fk_claim_user FOREIGN KEY (userId) REFERENCES user_information(userId),
  CONSTRAINT fk_claim_status FOREIGN KEY (statusId) REFERENCES `status`(statusId)
) ENGINE=InnoDB;

CREATE TABLE work_information (
  workId BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  userId VARCHAR(50) NOT NULL,
  sessionId INT UNSIGNED NOT NULL,
  offeringId BIGINT UNSIGNED NULL,
  claimId BIGINT UNSIGNED NULL,
  workDate DATE NOT NULL,
  startTime TIME NOT NULL,
  endTime TIME NOT NULL,
  hours DECIMAL(5,2) NOT NULL,
  KEY ix_work_user_date (userId, workDate),
  CONSTRAINT fk_work_user FOREIGN KEY (userId) REFERENCES user_information(userId),
  CONSTRAINT fk_work_session FOREIGN KEY (sessionId) REFERENCES `session`(sessionId),
  CONSTRAINT fk_work_offering FOREIGN KEY (offeringId, sessionId)
    REFERENCES course_offerings(offeringId, sessionId),
  CONSTRAINT fk_work_claim_owner FOREIGN KEY (claimId, userId)
    REFERENCES claims(claimId, userId),
  CONSTRAINT ck_work_clock CHECK (
    startTime >= '00:00:00' AND endTime < '24:00:00' AND endTime > startTime
  ),
  CONSTRAINT ck_work_hours CHECK (hours > 0 AND hours <= 24)
) ENGINE=InnoDB;

START TRANSACTION;
INSERT INTO user_role (roleId, roleName) VALUES
  (1, 'Instructor'), (2, 'Teaching Assistant'), (3, 'Student Helper');
INSERT INTO `session` (sessionId, sessionName) VALUES
  (1, 'normal'), (2, 'special');
INSERT INTO `status` (statusId, statusName) VALUES
  (1, 'Draft'), (2, 'Pending Review'), (3, 'Approved'),
  (4, 'Rejected'), (5, 'Returned for Revision');
INSERT INTO table_types (tableName, description) VALUES
  ('user_information', 'User information with one work role per user'),
  ('user_role', 'Work roles'),
  ('compensation_rates', 'Hourly compensation rates by program and work role'),
  ('compensation_rules', 'Compensation limits and rule descriptions'),
  ('courses_name', 'Course codes and names'),
  ('course_offerings', 'Course offerings by academic year, semester, and program'),
  ('session', 'Normal and special programs'),
  ('claims', 'Compensation claims and their current status'),
  ('status', 'Claim status definitions'),
  ('work_information', 'Actual work dates, time intervals, and hours');
COMMIT;

SHOW TABLES;
SELECT COUNT(*) AS tableCount
FROM information_schema.tables
WHERE table_schema = 'cs361_compensation'
  AND table_type = 'BASE TABLE';