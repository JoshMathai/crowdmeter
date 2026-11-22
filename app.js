// Send a request to the back end through the front-end server.
async function api(path, method = "GET", body) {
  const options = {
    method,
    credentials: "same-origin"
  };

  if (body !== undefined) {
    options.headers = {
      "Content-Type": "application/json"
    };

    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }

  return data;
}

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

// Create an account when the Register form is submitted.
if (registerForm) {
  registerForm.addEventListener("submit", async event => {
    event.preventDefault();

    const fields = new FormData(registerForm);

    if (fields.get("password") !== fields.get("confirm")) {
      message.textContent = "Passwords do not match.";
      return;
    }

    message.textContent = "Creating account...";

    try {
      const result = await api("/api/register", "POST", {
        username: fields.get("username"),
        email: fields.get("email"),
        password: fields.get("password")
      });

      message.textContent = result.message;
      registerForm.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

// Sign in when the Login form is submitted.
if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    const fields = new FormData(loginForm);
    message.textContent = "Logging in...";

    try {
      await api("/api/login", "POST", {
        username: fields.get("username"),
        password: fields.get("password")
      });

      window.location.href = "/";
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

const accountStatus = document.getElementById("accountStatus");
const logoutButton = document.getElementById("logoutButton");

// Ask the server whether this browser is signed in.
if (accountStatus) {
  api("/api/me")
    .then(user => {
      accountStatus.textContent = `Signed in as ${user.username}`;
      logoutButton.hidden = false;
    })
    .catch(error => {
      accountStatus.textContent =
        error.message === "Not signed in."
          ? "You are not signed in."
          : error.message;
    });
}

// End the session when Log out is clicked.
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/logout", "POST");
      window.location.reload();
    } catch (error) {
      accountStatus.textContent = error.message;
    }
  });
}