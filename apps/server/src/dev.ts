// Development entry point. The API always listens on TRUESIGHT_PORT (default 8787)
// so the Vite dev server can keep its own port even when tools inject PORT.
process.env.PORT = process.env.TRUESIGHT_PORT ?? "8787";
await import("./index.js");
