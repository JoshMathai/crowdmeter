import express from "express";
import { MongoClient } from "mongodb";
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash
} from "node:crypto";
import { promisify } from "node:util";

// Turn Node's password-hashing function into an awaitable function.
const deriveKey = promisify(scrypt);

const app = express();
app.disable("x-powered-by");

// Only accept small JSON request bodies.
app.use(express.json({ limit: "10kb" }));

const origin = process.env.APP_ORIGIN;
const secureCookie = process.env.COOKIE_SECURE === "true";
const cookieName = "cm_m2";
const sessionLength = 8 * 60 * 60 * 1000;

// Connect to the database before accepting account requests.
const client = new MongoClient(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
});

await client.connect();

const database = client.db("crowdmeter");
const users = database.collection("users");
const sessions = database.collection("sessions");

// Prevent two accounts from using the same username or email.
await users.createIndex({ username: 1 }, { unique: true });
await users.createIndex({ email: 1 }, { unique: true });

// MongoDB removes expired sessions automatically.
await sessions.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// These settings make password guessing more expensive.
const hashSettings = {
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 128 * 1024 * 1024
};

// Create a different salt and password hash for each account.
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64, hashSettings);

  return `${salt}:${key.toString("hex")}`;
}

// Compare a supplied password with the saved hash.
async function checkPassword(password, savedHash) {
  if (
    typeof savedHash !== "string" ||
    !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(savedHash)
  ) {
    return false;
  }

  const [salt, savedKey] = savedHash.split(":");
  const expected = Buffer.from(savedKey, "hex");
  const actual = await deriveKey(password, salt, 64, hashSettings);

  return timingSafeEqual(expected, actual);
}

// Unknown usernames still perform a password check.
const dummyHash = await hashPassword(
  randomBytes(24).toString("hex")
);

// Only accept text where the API expects text.
function isText(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

// Store a hash of the session token instead of the token itself.
function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Read the login cookie without needing another package.
function readToken(request) {
  const entry = (request.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${cookieName}=`));

  const token = entry?.slice(cookieName.length + 1);

  return /^[a-f0-9]{64}$/.test(token || "") ? token : null;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: secureCookie,
  path: "/"
};

// Find the account belonging to a valid, unexpired session.
async function signedInUser(request) {
  const token = readToken(request);
  if (!token) return null;

  const session = await sessions.findOne({
    _id: tokenHash(token),
    expiresAt: { $gt: new Date() }
  });

  if (!session) return null;

  return users.findOne(
    { _id: session.userId },
    { projection: { username: 1 } }
  );
}

// Accept browser changes only from our own front-end address.
app.use((request, response, next) => {
  response.set("Cache-Control", "no-store");

  if (
    request.method === "POST" &&
    request.get("origin") !== origin
  ) {
    return response.status(403).json({
      error: "Request origin is not allowed."
    });
  }

  next();
});

// A simple shared limit for this small class project.
// It limits all registration/login attempts together.
let attempts = 0;
let windowStarted = Date.now();

function limitAccountAttempts(request, response, next) {
  if (Date.now() - windowStarted >= 60000) {
    attempts = 0;
    windowStarted = Date.now();
  }

  attempts += 1;

  if (attempts > 30) {
    response.set("Retry-After", "60");

    return response.status(429).json({
      error: "Too many attempts. Wait one minute and try again."
    });
  }

  next();
}

// Check that the back end can reach MongoDB.
app.get("/api/health", async (request, response) => {
  await database.command({ ping: 1 });
  response.json({ ok: true });
});

// Create an account.
app.post(
  "/api/register",
  limitAccountAttempts,
  async (request, response) => {
    const { username, email, password } = request.body || {};

    if (
      !isText(username, 3, 24) ||
      !isText(email, 1, 254) ||
      !isText(password, 12, 128)
    ) {
      return response.status(400).json({
        error: "Check the username, email and password lengths."
      });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) {
      return response.status(400).json({
        error: "Use 3–24 letters, numbers or underscores for the username."
      });
    }

    if (!/^[^\s@]+@njit\.edu$/.test(cleanEmail)) {
      return response.status(400).json({
        error: "Use an @njit.edu email address."
      });
    }

    if (
      !/[A-Za-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      return response.status(400).json({
        error: "The password needs a letter and a number."
      });
    }

    // Select the allowed fields ourselves; do not save the whole request.
    await users.insertOne({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash: await hashPassword(password),
      createdAt: new Date()
    });

    response.status(201).json({
      message: "Account created. You can now log in."
    });
  }
);

// Check credentials and create a login session.
app.post(
  "/api/login",
  limitAccountAttempts,
  async (request, response) => {
    const { username, password } = request.body || {};

    if (
      !isText(username, 3, 24) ||
      !isText(password, 1, 128)
    ) {
      return response.status(400).json({
        error: "Enter a valid username and password."
      });
    }

    // An object such as {$ne: null} cannot pass the text check above.
    const user = await users.findOne({
      username: username.trim().toLowerCase()
    });

    const matches = await checkPassword(
      password,
      user?.passwordHash || dummyHash
    );

    if (!user || !matches) {
      return response.status(401).json({
        error: "Invalid username or password."
      });
    }

    // Replace this browser's previous session after a successful login.
    const previousToken = readToken(request);

    if (previousToken) {
      await sessions.deleteOne({
        _id: tokenHash(previousToken)
      });
    }

    const token = randomBytes(32).toString("hex");

    await sessions.insertOne({
      _id: tokenHash(token),
      userId: user._id,
      expiresAt: new Date(Date.now() + sessionLength)
    });

    response.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: sessionLength
    });

    response.json({ message: "Logged in." });
  }
);

// Return account information only when the session is valid.
app.get("/api/me", async (request, response) => {
  const user = await signedInUser(request);

  if (!user) {
    return response.status(401).json({
      error: "Not signed in."
    });
  }

  // Never return password hashes to the browser.
  response.json({ username: user.username });
});

// Remove the session and login cookie.
app.post("/api/logout", async (request, response) => {
  const token = readToken(request);

  if (token) {
    await sessions.deleteOne({ _id: tokenHash(token) });
  }

  response.clearCookie(cookieName, cookieOptions);
  response.json({ message: "Logged out." });
});

// Show useful errors without exposing database details.
app.use((error, request, response, next) => {
  if (error.code === 11000) {
    return response.status(409).json({
      error: "That username or email is already registered."
    });
  }

  if (error.status === 400 || error.status === 413) {
    return response.status(error.status).json({
      error: "The request contains invalid or oversized data."
    });
  }

  console.error("Request failed:", error.name);

  response.status(500).json({
    error: "Server error. Check the back-end terminal."
  });
});

const port = Number(process.env.BACKEND_PORT || 3000);
const host = process.env.BACKEND_HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`Back end running at http://${host}:${port}`);
});