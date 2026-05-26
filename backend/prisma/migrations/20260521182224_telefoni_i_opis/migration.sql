/*
  Warnings:

  - Added the required column `description` to the `Apartment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Booking_startDate_endDate_idx";

-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN     "description" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "phone" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_apartmentId_startDate_endDate_idx" ON "Booking"("apartmentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ReservationRequest_status_expiresAt_idx" ON "ReservationRequest"("status", "expiresAt");
