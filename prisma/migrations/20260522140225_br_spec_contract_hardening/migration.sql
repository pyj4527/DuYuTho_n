-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Recipe_householdId_deletedAt_idx" ON "Recipe"("householdId", "deletedAt");
