/* eslint-disable import/no-extraneous-dependencies, no-console */
const { find } = require("lodash");
const atob = require("atob");
const { execSync } = require("child_process");
const { get, post } = require("request").defaults({ jar: true });
const { seedData } = require("./seed-data");
const fs = require("fs");
const path = require("path");
var Cookie = require("request-cookies").Cookie;

const rootPath = path.join(__dirname, "../..");

let cypressConfigBaseUrl;
try {
  const cypressConfig = JSON.parse(fs.readFileSync("cypress.json"));
  cypressConfigBaseUrl = cypressConfig.baseUrl;
} catch (e) {}

const baseUrl =
  process.env.CYPRESS_baseUrl ||
  cypressConfigBaseUrl ||
  "http://localhost:5000";

function seedDatabase(seedValues) {
  get(baseUrl + "/login", (_, { headers }) => {
    const request = seedValues.shift();
    const data =
      request.type === "form"
        ? { formData: request.data }
        : { json: request.data };

    if (headers["set-cookie"]) {
      const cookies = headers["set-cookie"].map(cookie => new Cookie(cookie));
      const csrfCookie = find(cookies, { key: "csrf_token" });
      if (csrfCookie) {
        if (request.type === "form") {
          data["formData"] = {
            ...data["formData"],
            csrf_token: csrfCookie.value
          };
        } else {
          data["headers"] = { "X-CSRFToken": csrfCookie.value };
        }
      }
    }

    post(baseUrl + request.route, data, (err, response) => {
      const result = response ? response.statusCode : err;
      console.log("POST " + request.route + " - " + result);
      if (seedValues.length) {
        seedDatabase(seedValues);
      }
    });
  });
}

function buildServer() {
  console.log("Building the server...");
  execSync("docker-compose -p cypress build", {
    stdio: "inherit",
    cwd: rootPath
  });
}

function startServer() {
  console.log("Starting the server...");
  execSync("docker-compose -p cypress up -d", {
    stdio: "inherit",
    cwd: rootPath
  });
  execSync("docker-compose -p cypress run server create_db", {
    stdio: "inherit",
    cwd: rootPath
  });
}

function stopServer() {
  console.log("Stopping the server...");
  execSync("docker-compose -p cypress down", {
    stdio: "inherit",
    cwd: rootPath
  });
}

function runCypressCI() {
  const {
    PERCY_TOKEN_ENCODED,
    CYPRESS_PROJECT_ID_ENCODED,
    CYPRESS_RECORD_KEY_ENCODED,
    CIRCLE_REPOSITORY_URL
  } = process.env;

  if (
    CIRCLE_REPOSITORY_URL &&
    CIRCLE_REPOSITORY_URL.includes("getredash/redash")
  ) {
    if (PERCY_TOKEN_ENCODED) {
      process.env.PERCY_TOKEN = atob(`${PERCY_TOKEN_ENCODED}`);
    }
    if (CYPRESS_PROJECT_ID_ENCODED) {
      process.env.CYPRESS_PROJECT_ID = atob(`${CYPRESS_PROJECT_ID_ENCODED}`);
    }
    if (CYPRESS_RECORD_KEY_ENCODED) {
      process.env.CYPRESS_RECORD_KEY = atob(`${CYPRESS_RECORD_KEY_ENCODED}`);
    }
  }

  execSync(
    "COMMIT_INFO_MESSAGE=$(git show -s --format=%s) docker-compose run --name cypress cypress ./node_modules/.bin/percy exec -t 300 -- ./node_modules/.bin/cypress run --record",
    { stdio: "inherit", cwd: rootPath }
  );
}

const command = process.argv[2] || "all";

switch (command) {
  case "build":
    buildServer();
    break;
  case "start":
    startServer();
    if (!process.argv.includes("--skip-db-seed")) {
      seedDatabase(seedData);
    }
    break;
  case "db-seed":
    seedDatabase(seedData);
    break;
  case "run":
    execSync("cypress run --config-file=./cypress.json", { stdio: "inherit" });
    break;
  case "open":
    execSync("cypress open --config-file=./cypress.json", { stdio: "inherit" });
    break;
  case "run-ci":
    runCypressCI();
    break;
  case "stop":
    stopServer();
    break;
  case "all":
    startServer();
    seedDatabase(seedData);
    execSync("cypress run --config-file=./cypress.json", { stdio: "inherit" });
    stopServer();
    break;
  default:
    console.log("Usage: yarn cy [build|start|db-seed|open|run|stop]");
    break;
}
