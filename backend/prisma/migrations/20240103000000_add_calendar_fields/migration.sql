-- AlterTable: add Google Calendar integration fields to ApplicationRecord
ALTER TABLE "application_records" ADD COLUMN "calendarEventId" TEXT;
ALTER TABLE "application_records" ADD COLUMN "interviewDate" TIMESTAMP(3);
ALTER TABLE "application_records" ADD COLUMN "interviewDuration" INTEGER;
ALTER TABLE "application_records" ADD COLUMN "interviewFormat" TEXT;
