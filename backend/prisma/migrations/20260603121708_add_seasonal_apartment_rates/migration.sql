-- CreateTable
CREATE TABLE "ApartmentRate" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApartmentRate_apartmentId_startDate_endDate_idx" ON "ApartmentRate"("apartmentId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "ApartmentRate" ADD CONSTRAINT "ApartmentRate_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
