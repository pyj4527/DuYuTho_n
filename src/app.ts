import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { healthRoute } from "./routes/health.route";
import { inventoryRoute } from "./routes/inventory.route";


export const app = new Elysia()
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "Fridge Waste Backend API",
          version: "0.1.0",
          description:
            "AI 기반 식재료 후보 추출, 인벤토리 관리, 폐기 위험도 추천 백엔드 API",
        },
      },
    })
  )
  .get("/", () => {
    return {
      ok: true,
      service: "fridge-waste-backend",
      message: "Backend server is running",
    };
  })
  .use(healthRoute)
    .use(inventoryRoute)
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;

      return {
        error: "NOT_FOUND",
        message: "Route not found",
      };
    }

    console.error(error);

    set.status = 500;

    return {
      error: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    };
  });