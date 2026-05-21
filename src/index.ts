import "dotenv/config";

import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);

app.listen(port);

console.log(`Server is running at http://localhost:${port}`);
console.log(`Swagger UI: http://localhost:${port}/swagger`);
console.log(`Health check: http://localhost:${port}/health`);