import http from "node:http";
import { readFile } from "node:fs/promises";

// Only these public files can be downloaded.
// Private settings and back-end source code are not exposed.
const files = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/login.html": ["login.html", "text/html"],
  "/register.html": ["register.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"]
};

const apiAddress = process.env.API_BASE_URL;
const port = Number(process.env.FRONTEND_PORT || 8082);
const host = process.env.FRONTEND_HOST || "127.0.0.1";

http.createServer(async (request, response) => {
  const path = new URL(
    request.url,
    "http://localhost"
  ).pathname;

  response.setHeader("X-Content-Type-Options", "nosniff");

  // Send account requests to Express.
  // The browser keeps using the same front-end address.
  if (path.startsWith("/api/")) {
    const destination = new URL(request.url, apiAddress);

    const proxy = http.request(
      destination,
      {
        method: request.method,
        headers: {
          ...request.headers,
          host: destination.host
        }
      },
      upstream => {
        // This also forwards the login cookie from Express.
        response.writeHead(
          upstream.statusCode,
          upstream.headers
        );

        upstream.on("error", () => response.destroy());
        upstream.pipe(response);
      }
    );

    proxy.setTimeout(10000, () => proxy.destroy());

    proxy.on("error", () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      response.writeHead(502, {
        "Content-Type": "application/json"
      });

      response.end(JSON.stringify({
        error: "The back end is unavailable. Start it first."
      }));
    });

    request.on("aborted", () => proxy.destroy());
    request.pipe(proxy);
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  const file = files[path];

  if (!file) {
    response.writeHead(404);
    response.end("Page not found");
    return;
  }

  try {
    // Read the file from this server's folder.
    const content = await readFile(
      new URL(file[0], import.meta.url)
    );

    response.writeHead(200, {
      "Content-Type": `${file[1]}; charset=utf-8`,
      "Cache-Control": "no-store"
    });

    response.end(
      request.method === "HEAD" ? undefined : content
    );
  } catch {
    response.writeHead(500);
    response.end("Could not load the page");
  }
}).listen(port, host, () => {
  console.log(`Front end running at http://${host}:${port}`);
});