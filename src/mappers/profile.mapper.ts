import type {
  Household,
  HouseholdSettings,
  UserProfile,
} from "../../generated/prisma/client";
import type {
  ClientPreferenceDto,
  DietaryPreferenceDto,
  HouseholdDto,
  HouseholdSettingsDto,
  NotificationPreferenceDto,
  UserProfileDto,
} from "../domain/dto";
import { toRfc3339 } from "../lib/date";
import { normalizeLocation } from "./inventory.mapper";

export function mapHousehold(household: Household): HouseholdDto {
  return {
    id: household.id,
    name: household.name,
    memberCount: household.memberCount,
    timezone: household.timezone,
    defaultStorageLocation: normalizeLocation(household.defaultStorageLocation),
    createdAt: toRfc3339(household.createdAt),
    updatedAt: toRfc3339(household.updatedAt),
  };
}

export function mapUserProfile(profile: UserProfile): UserProfileDto {
  return {
    id: profile.id,
    householdId: profile.householdId,
    nickname: profile.nickname,
    email: profile.email ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
    createdAt: toRfc3339(profile.createdAt),
    updatedAt: toRfc3339(profile.updatedAt),
  };
}

export function mapDietary(settings: HouseholdSettings): DietaryPreferenceDto {
  return {
    excludedIngredients: settings.excludedIngredients,
    dislikedFoods: settings.dislikedFoods,
    allergies: settings.allergies,
    preferredCookTimeMinutes: settings.preferredCookTimeMinutes ?? undefined,
    mildFlavorPreferred: settings.mildFlavorPreferred ?? undefined,
  };
}

export function mapNotifications(settings: HouseholdSettings): NotificationPreferenceDto {
  const quietHours = settings.quietHoursStart && settings.quietHoursEnd
    ? { start: settings.quietHoursStart, end: settings.quietHoursEnd }
    : undefined;

  return {
    expiryReminderEnabled: settings.expiryReminderEnabled,
    expiryReminderDaysBefore: settings.expiryReminderDaysBefore,
    expiryReminderTime: settings.expiryReminderTime,
    recipeConsumeReminderEnabled: settings.recipeConsumeReminderEnabled,
    reviewPendingReminderEnabled: settings.reviewPendingReminderEnabled,
    quietHours,
  };
}

export function mapHouseholdSettings(input: {
  household: Household;
  profile: UserProfile;
  settings: HouseholdSettings;
}): HouseholdSettingsDto {
  return {
    household: mapHousehold(input.household),
    profile: mapUserProfile(input.profile),
    dietary: mapDietary(input.settings),
    notifications: mapNotifications(input.settings),
  };
}

export function mapClientPreferences(settings: HouseholdSettings): ClientPreferenceDto {
  return {
    theme: settings.theme === "light" || settings.theme === "dark" || settings.theme === "system"
      ? settings.theme
      : undefined,
    onboardingCompleted: settings.onboardingCompleted ?? undefined,
    onboardingCompletedAt: settings.onboardingCompletedAt
      ? toRfc3339(settings.onboardingCompletedAt)
      : null,
  };
}
