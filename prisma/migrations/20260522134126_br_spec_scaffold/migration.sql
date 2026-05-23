/*
  Warnings:

  - You are about to drop the column `expiresAtSource` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `freshnessScore` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `freshnessSource` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `perishabilityScore` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `perishabilitySource` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `sourceUploadId` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `unit` on the `InventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `InventoryItem` table. All the data in the column will be lost.
  - The `status` column on the `InventoryItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Upload` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UploadDetection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WasteEvent` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `householdId` to the `InventoryItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantityLabel` to the `InventoryItem` table without a default value. This is not possible if the table is not empty.
  - Made the column `location` on table `InventoryItem` required. This step will fail if there are existing NULL values in that column.
  - Made the column `expiresAt` on table `InventoryItem` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_sourceUploadId_fkey";

-- DropForeignKey
ALTER TABLE "UploadDetection" DROP CONSTRAINT "UploadDetection_inventoryItemId_fkey";

-- DropForeignKey
ALTER TABLE "UploadDetection" DROP CONSTRAINT "UploadDetection_uploadId_fkey";

-- DropForeignKey
ALTER TABLE "WasteEvent" DROP CONSTRAINT "WasteEvent_inventoryItemId_fkey";

-- DropIndex
DROP INDEX "InventoryItem_category_idx";

-- DropIndex
DROP INDEX "InventoryItem_createdAt_idx";

-- DropIndex
DROP INDEX "InventoryItem_expiresAt_idx";

-- DropIndex
DROP INDEX "InventoryItem_status_idx";

-- DropIndex
DROP INDEX "InventoryItem_userId_idx";

-- AlterTable
ALTER TABLE "InventoryItem" DROP COLUMN "expiresAtSource",
DROP COLUMN "freshnessScore",
DROP COLUMN "freshnessSource",
DROP COLUMN "perishabilityScore",
DROP COLUMN "perishabilitySource",
DROP COLUMN "quantity",
DROP COLUMN "sourceType",
DROP COLUMN "sourceUploadId",
DROP COLUMN "unit",
DROP COLUMN "userId",
ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "discardedAt" TIMESTAMP(3),
ADD COLUMN     "householdId" TEXT NOT NULL,
ADD COLUMN     "memo" TEXT,
ADD COLUMN     "quantityAmount" DOUBLE PRECISION,
ADD COLUMN     "quantityLabel" TEXT NOT NULL,
ADD COLUMN     "quantityUnit" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "sourceAnalysisId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "location" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL,
ALTER COLUMN "expiresAt" SET DATA TYPE TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- DropTable
DROP TABLE "Upload";

-- DropTable
DROP TABLE "UploadDetection";

-- DropTable
DROP TABLE "WasteEvent";

-- DropEnum
DROP TYPE "DetectionStatus";

-- DropEnum
DROP TYPE "ExpiresAtSource";

-- DropEnum
DROP TYPE "FreshnessSource";

-- DropEnum
DROP TYPE "InventorySourceType";

-- DropEnum
DROP TYPE "InventoryStatus";

-- DropEnum
DROP TYPE "PerishabilitySource";

-- DropEnum
DROP TYPE "UploadStatus";

-- DropEnum
DROP TYPE "UploadType";

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "defaultStorageLocation" TEXT NOT NULL DEFAULT '냉장',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdSettings" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "excludedIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dislikedFoods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredCookTimeMinutes" INTEGER,
    "mildFlavorPreferred" BOOLEAN,
    "expiryReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "expiryReminderDaysBefore" INTEGER[] DEFAULT ARRAY[2, 0]::INTEGER[],
    "expiryReminderTime" TEXT NOT NULL DEFAULT '09:00',
    "recipeConsumeReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reviewPendingReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "theme" TEXT,
    "onboardingCompleted" BOOLEAN,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySelection" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "selectedIngredientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LensAnalysis" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawText" TEXT,
    "imageMime" TEXT,
    "imageSize" INTEGER,
    "result" JSONB,
    "problem" JSONB,
    "providerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LensAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredients" JSONB NOT NULL,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "time" TEXT NOT NULL,
    "timeMinutes" INTEGER,
    "description" TEXT,
    "imageUrl" TEXT,
    "servings" INTEGER,
    "difficulty" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dietaryFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "steps" JSONB,
    "nutrition" JSONB,
    "source" TEXT NOT NULL DEFAULT 'migration',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeSave" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "saved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeConsumptionLog" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeName" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL,
    "selectedIngredientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "removedItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeConsumptionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "expirationTime" BIGINT,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "timezone" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrototypeImport" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clientGeneratedAt" TIMESTAMP(3) NOT NULL,
    "strategy" TEXT NOT NULL,
    "importedItems" INTEGER NOT NULL,
    "importedRecipes" INTEGER NOT NULL,
    "importedSelections" INTEGER NOT NULL,
    "idMap" JSONB NOT NULL,
    "skipped" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrototypeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "status" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_householdId_key" ON "UserProfile"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdSettings_householdId_key" ON "HouseholdSettings"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySelection_householdId_key" ON "InventorySelection"("householdId");

-- CreateIndex
CREATE INDEX "LensAnalysis_householdId_idx" ON "LensAnalysis"("householdId");

-- CreateIndex
CREATE INDEX "LensAnalysis_householdId_status_idx" ON "LensAnalysis"("householdId", "status");

-- CreateIndex
CREATE INDEX "LensAnalysis_createdAt_idx" ON "LensAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "Recipe_householdId_idx" ON "Recipe"("householdId");

-- CreateIndex
CREATE INDEX "Recipe_householdId_name_idx" ON "Recipe"("householdId", "name");

-- CreateIndex
CREATE INDEX "RecipeSave_householdId_idx" ON "RecipeSave"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeSave_householdId_recipeId_key" ON "RecipeSave"("householdId", "recipeId");

-- CreateIndex
CREATE INDEX "RecipeConsumptionLog_householdId_idx" ON "RecipeConsumptionLog"("householdId");

-- CreateIndex
CREATE INDEX "RecipeConsumptionLog_householdId_consumedAt_idx" ON "RecipeConsumptionLog"("householdId", "consumedAt");

-- CreateIndex
CREATE INDEX "PushSubscription_householdId_idx" ON "PushSubscription"("householdId");

-- CreateIndex
CREATE INDEX "PushSubscription_householdId_active_idx" ON "PushSubscription"("householdId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_householdId_endpoint_key" ON "PushSubscription"("householdId", "endpoint");

-- CreateIndex
CREATE INDEX "PrototypeImport_householdId_idx" ON "PrototypeImport"("householdId");

-- CreateIndex
CREATE INDEX "PrototypeImport_createdAt_idx" ON "PrototypeImport"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_householdId_endpoint_key_key" ON "IdempotencyRecord"("householdId", "endpoint", "key");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_idx" ON "InventoryItem"("householdId");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_status_idx" ON "InventoryItem"("householdId", "status");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_expiresAt_idx" ON "InventoryItem"("householdId", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_createdAt_idx" ON "InventoryItem"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_name_idx" ON "InventoryItem"("householdId", "name");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdSettings" ADD CONSTRAINT "HouseholdSettings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySelection" ADD CONSTRAINT "InventorySelection_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensAnalysis" ADD CONSTRAINT "LensAnalysis_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSave" ADD CONSTRAINT "RecipeSave_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeConsumptionLog" ADD CONSTRAINT "RecipeConsumptionLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrototypeImport" ADD CONSTRAINT "PrototypeImport_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
