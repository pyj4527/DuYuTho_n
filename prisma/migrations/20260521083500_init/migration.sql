-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('FRIDGE', 'RECEIPT', 'TEXT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DetectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'WASTED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "InventorySourceType" AS ENUM ('MANUAL', 'UPLOAD_DETECTION', 'TEXT');

-- CreateEnum
CREATE TYPE "ExpiresAtSource" AS ENUM ('USER', 'PACKAGE_OCR', 'RECEIPT_RULE', 'CATEGORY_DEFAULT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FreshnessSource" AS ENUM ('IMAGE_AI', 'PURCHASE_DEFAULT', 'USER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PerishabilitySource" AS ENUM ('INGREDIENT_DEFAULT', 'CATEGORY_DEFAULT', 'USER_ADJUSTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UploadType" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT,
    "originalText" TEXT,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadDetection" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "detectedName" TEXT NOT NULL,
    "correctedName" TEXT,
    "category" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "location" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expiresAtSource" "ExpiresAtSource" NOT NULL DEFAULT 'UNKNOWN',
    "freshnessScore" INTEGER,
    "freshnessSource" "FreshnessSource" NOT NULL DEFAULT 'UNKNOWN',
    "perishabilityScore" INTEGER,
    "perishabilitySource" "PerishabilitySource" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION,
    "conditionTags" JSONB,
    "freshnessSignals" JSONB,
    "rawData" JSONB,
    "status" "DetectionStatus" NOT NULL DEFAULT 'PENDING',
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadDetection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "location" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expiresAtSource" "ExpiresAtSource" NOT NULL DEFAULT 'UNKNOWN',
    "freshnessScore" INTEGER,
    "freshnessSource" "FreshnessSource" NOT NULL DEFAULT 'UNKNOWN',
    "perishabilityScore" INTEGER,
    "perishabilitySource" "PerishabilitySource" NOT NULL DEFAULT 'UNKNOWN',
    "status" "InventoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "InventorySourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceUploadId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "reason" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WasteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");

-- CreateIndex
CREATE INDEX "Upload_type_idx" ON "Upload"("type");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadDetection_inventoryItemId_key" ON "UploadDetection"("inventoryItemId");

-- CreateIndex
CREATE INDEX "UploadDetection_uploadId_idx" ON "UploadDetection"("uploadId");

-- CreateIndex
CREATE INDEX "UploadDetection_status_idx" ON "UploadDetection"("status");

-- CreateIndex
CREATE INDEX "UploadDetection_detectedName_idx" ON "UploadDetection"("detectedName");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");

-- CreateIndex
CREATE INDEX "InventoryItem_expiresAt_idx" ON "InventoryItem"("expiresAt");

-- CreateIndex
CREATE INDEX "InventoryItem_createdAt_idx" ON "InventoryItem"("createdAt");

-- CreateIndex
CREATE INDEX "WasteEvent_userId_idx" ON "WasteEvent"("userId");

-- CreateIndex
CREATE INDEX "WasteEvent_inventoryItemId_idx" ON "WasteEvent"("inventoryItemId");

-- CreateIndex
CREATE INDEX "WasteEvent_createdAt_idx" ON "WasteEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "UploadDetection" ADD CONSTRAINT "UploadDetection_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadDetection" ADD CONSTRAINT "UploadDetection_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_sourceUploadId_fkey" FOREIGN KEY ("sourceUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteEvent" ADD CONSTRAINT "WasteEvent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
