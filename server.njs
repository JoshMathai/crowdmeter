import http from "node:http";
import { readFile } from "node:fs/promises";

// Only these files can be requested through the server.
const files = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/login.html": ["login.html", "text/html"],
  "/register.html": ["register.html", "text/html"],
  "/style.css": ["style.css", "text/css"]
};

http.createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = files[path];

  if (!file) {
    response.writeHead(404);
    response.end("Page not found");
    return;
  }

  try {
    const content = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      "Content-Type": file[1] + "; charset=utf-8"
    });
    response.end(content);
  } catch {
    response.writeHead(500);
    response.end("Could not load file");
  }
}).listen(8080, "0.0.0.0", () => {
  console.log("CrowdMeter running on port 8080");
});