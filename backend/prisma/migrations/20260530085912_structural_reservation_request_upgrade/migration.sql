/*
  Warnings:

  - You are about to drop the `ReservationRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ReservationRequest" DROP CONSTRAINT "ReservationRequest_apartmentId_fkey";

-- DropTable
DROP TABLE "ReservationRequest";

-- CreateTable
CREATE TABLE "reservation_requests" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "guest" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "emailToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_requests_emailToken_key" ON "reservation_requests"("emailToken");

-- CreateIndex
CREATE INDEX "reservation_requests_status_expiresAt_idx" ON "reservation_requests"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "reservation_requests" ADD CONSTRAINT "reservation_requests_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
