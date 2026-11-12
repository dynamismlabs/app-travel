// Travel runs as a service on the person's computer only. Its writes are
// synchronous SQLite transactions on its own connection to the app's database
// (src/db/connection.ts), which Cloudflare D1 can't offer. The kit's build
// always bundles a Worker, so this one says so instead of serving Travel.
// See docs/parity.md ("Runs on Cloudflare").
export default {
  scheduled() { /* No jobs run here. */ },
  fetch() {
    return new Response("Travel runs as a service on your computer, not on Cloudflare. Install it with app-builder serve --install.", { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
