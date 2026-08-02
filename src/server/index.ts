import { translatorStore } from "./translator-store";

const PORT = Number(process.env.PORT ?? 3001);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Build the automaton once before accepting traffic.
await translatorStore.reload();

const server = Bun.serve({
  port: PORT,
  routes: {
    "/health": {
      GET: () => json({ status: "ok", ...translatorStore.status() }),
    },

    "/translate": {
      POST: async (req) => {
        let body: { text?: unknown };
        try {
          body = (await req.json()) as { text?: unknown };
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        if (typeof body.text !== "string") {
          return json({ error: "Field 'text' (string) is required" }, 400);
        }
        return json(translatorStore.get().translate(body.text));
      },
    },

    "/reload": {
      POST: async () => {
        try {
          const info = await translatorStore.reload();
          return json({ status: "reloaded", ...info });
        } catch (err) {
          return json(
            { error: "Reload failed", detail: err instanceof Error ? err.message : String(err) },
            500
          );
        }
      },
    },
  },

  fetch: () => json({ error: "Not found" }, 404),
});

console.log(`transjawa-aho listening on http://localhost:${server.port}`);
console.log("  POST /translate  { text }");
console.log("  POST /reload");
console.log("  GET  /health");
