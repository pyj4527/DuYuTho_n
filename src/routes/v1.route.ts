import { Elysia } from "elysia";
import { homeRoute } from "./home.route";
import { inventoryRoute } from "./inventory.route";
import { lensRoute } from "./lens.route";
import { notificationRoute } from "./notification.route";
import { profileRoute } from "./profile.route";
import { pushRoute } from "./push.route";
import { recipeRoute } from "./recipe.route";
import { syncRoute } from "./sync.route";

export const v1Route = new Elysia({ prefix: "/api/v1" })
  .use(inventoryRoute)
  .use(homeRoute)
  .use(lensRoute)
  .use(recipeRoute)
  .use(pushRoute)
  .use(notificationRoute)
  .use(profileRoute)
  .use(syncRoute);
