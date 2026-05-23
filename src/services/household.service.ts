import { prisma } from "../lib/prisma";
import type {
  ClientPreferenceDto,
  HouseholdSettingsDto,
  StorageLocation,
  UserProfileDto,
} from "../domain/dto";
import { mapClientPreferences, mapHouseholdSettings, mapUserProfile } from "../mappers/profile.mapper";
import { throwProblem } from "../lib/problem";

const defaultHouseholdName = "해커톤 팀 냉장고";
const defaultNickname = "잔반제로 사용자";

export type ProfilePatchInput = Partial<{
  nickname: string;
  email: string | null;
  avatarUrl: string | null;
}>;

export type HouseholdSettingsPatchInput = Partial<{
  household: Partial<{
    name: string;
    memberCount: number;
    timezone: string;
    defaultStorageLocation: StorageLocation;
  }>;
  dietary: Partial<{
    excludedIngredients: string[];
    dislikedFoods: string[];
    allergies: string[];
    preferredCookTimeMinutes: number | null;
    mildFlavorPreferred: boolean | null;
  }>;
  notifications: Partial<{
    expiryReminderEnabled: boolean;
    expiryReminderDaysBefore: number[];
    expiryReminderTime: string;
    recipeConsumeReminderEnabled: boolean;
    reviewPendingReminderEnabled: boolean;
    quietHours: { start: string; end: string } | null;
  }>;
}>;

export async function ensureHousehold(householdId: string) {
  const household = await prisma.household.upsert({
    where: { id: householdId },
    create: {
      id: householdId,
      name: defaultHouseholdName,
      memberCount: 2,
      timezone: "Asia/Seoul",
      defaultStorageLocation: "냉장",
      profile: {
        create: {
          nickname: defaultNickname,
        },
      },
      settings: {
        create: {},
      },
      selection: {
        create: {},
      },
    },
    update: {},
    include: {
      profile: true,
      settings: true,
    },
  });

  const existingProfile = household.profile;
  const existingSettings = household.settings;

  if (!existingProfile || !existingSettings) {
    const [profile, settings] = await Promise.all([
      prisma.userProfile.upsert({
        where: { householdId },
        create: { householdId, nickname: defaultNickname },
        update: {},
      }),
      prisma.householdSettings.upsert({
        where: { householdId },
        create: { householdId },
        update: {},
      }),
    ]);

    return {
      ...household,
      profile,
      settings,
    };
  }

  return {
    ...household,
    profile: existingProfile,
    settings: existingSettings,
  };
}

export const householdService = {
  async getSettings(householdId: string): Promise<HouseholdSettingsDto> {
    const household = await ensureHousehold(householdId);
    return mapHouseholdSettings({
      household,
      profile: household.profile,
      settings: household.settings,
    });
  },

  async updateProfile(householdId: string, input: ProfilePatchInput): Promise<UserProfileDto> {
    await ensureHousehold(householdId);

    const data: ProfilePatchInput = {};
    if (input.nickname !== undefined) {
      const nickname = input.nickname.trim();
      if (!nickname) {
        throwProblem({ status: 422, title: "Validation error", detail: "nickname is required" });
      }
      data.nickname = nickname;
    }
    if (input.email !== undefined) {
      data.email = input.email === null ? null : input.email.trim();
    }
    if (input.avatarUrl !== undefined) {
      data.avatarUrl = input.avatarUrl === null ? null : input.avatarUrl.trim();
    }

    const profile = await prisma.userProfile.update({
      where: { householdId },
      data,
    });

    return mapUserProfile(profile);
  },

  async updateSettings(
    householdId: string,
    input: HouseholdSettingsPatchInput,
  ): Promise<HouseholdSettingsDto> {
    await ensureHousehold(householdId);

    if (input.household) {
      await prisma.household.update({
        where: { id: householdId },
        data: {
          name: input.household.name?.trim(),
          memberCount: input.household.memberCount,
          timezone: input.household.timezone?.trim(),
          defaultStorageLocation: input.household.defaultStorageLocation,
        },
      });
    }

    const settingsData: Record<string, unknown> = {};
    if (input.dietary) {
      if (input.dietary.excludedIngredients !== undefined) {
        settingsData.excludedIngredients = input.dietary.excludedIngredients;
      }
      if (input.dietary.dislikedFoods !== undefined) {
        settingsData.dislikedFoods = input.dietary.dislikedFoods;
      }
      if (input.dietary.allergies !== undefined) {
        settingsData.allergies = input.dietary.allergies;
      }
      if (input.dietary.preferredCookTimeMinutes !== undefined) {
        settingsData.preferredCookTimeMinutes = input.dietary.preferredCookTimeMinutes;
      }
      if (input.dietary.mildFlavorPreferred !== undefined) {
        settingsData.mildFlavorPreferred = input.dietary.mildFlavorPreferred;
      }
    }
    if (input.notifications) {
      if (input.notifications.expiryReminderEnabled !== undefined) {
        settingsData.expiryReminderEnabled = input.notifications.expiryReminderEnabled;
      }
      if (input.notifications.expiryReminderDaysBefore !== undefined) {
        settingsData.expiryReminderDaysBefore = input.notifications.expiryReminderDaysBefore;
      }
      if (input.notifications.expiryReminderTime !== undefined) {
        settingsData.expiryReminderTime = input.notifications.expiryReminderTime;
      }
      if (input.notifications.recipeConsumeReminderEnabled !== undefined) {
        settingsData.recipeConsumeReminderEnabled = input.notifications.recipeConsumeReminderEnabled;
      }
      if (input.notifications.reviewPendingReminderEnabled !== undefined) {
        settingsData.reviewPendingReminderEnabled = input.notifications.reviewPendingReminderEnabled;
      }
      if (input.notifications.quietHours !== undefined) {
        settingsData.quietHoursStart = input.notifications.quietHours?.start ?? null;
        settingsData.quietHoursEnd = input.notifications.quietHours?.end ?? null;
      }
    }

    if (Object.keys(settingsData).length > 0) {
      await prisma.householdSettings.update({
        where: { householdId },
        data: settingsData,
      });
    }

    return this.getSettings(householdId);
  },

  async updateClientPreferences(
    householdId: string,
    input: ClientPreferenceDto,
  ): Promise<ClientPreferenceDto> {
    await ensureHousehold(householdId);

    const settings = await prisma.householdSettings.update({
      where: { householdId },
      data: {
        theme: input.theme,
        onboardingCompleted: input.onboardingCompleted,
        onboardingCompletedAt: input.onboardingCompletedAt === undefined
          ? undefined
          : input.onboardingCompletedAt === null
            ? null
            : new Date(input.onboardingCompletedAt),
      },
    });

    return mapClientPreferences(settings);
  },
};
