// Travel runs as a service on the person's computer only. Its writes are
// synchronous SQLite transactions through the core's transaction()
// (src/db/connection.ts), which runs on Node only until the kit moves an
// installation's database into a Durable Object on Cloudflare. app.config.ts
// declares platforms: ["node"], so deploy refuses Travel. The kit's build
// still bundles a Worker, so this one says so instead of serving Travel.
// See docs/parity.md ("Runs on Cloudflare").
export default {
  scheduled() { /* No jobs run here. */ },
  fetch() {
    return new Response("Travel runs as a service on your computer, not on Cloudflare. Install it with app-builder serve --install.", { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
