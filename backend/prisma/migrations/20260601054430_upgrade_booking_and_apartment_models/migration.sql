-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Apartment_isDeleted_idx" ON "Apartment"("isDeleted");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt" DESC);
