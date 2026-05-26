/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Apartment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Apartment_name_key" ON "Apartment"("name");
