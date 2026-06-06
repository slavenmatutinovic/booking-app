/*
  Warnings:

  - Added the required column `capacity` to the `ApartmentRate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ApartmentRate" ADD COLUMN     "capacity" INTEGER NOT NULL;
