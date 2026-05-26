-- DropIndex
DROP INDEX "ReservationRequest_token_key";

-- AlterTable
ALTER TABLE "ReservationRequest" ALTER COLUMN "token" DROP NOT NULL;
