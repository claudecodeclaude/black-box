#!/usr/bin/env node
// Apex App bootstrap — create the first admin user.
// Usage:  node bootstrap.mjs <username>
// Prompts for a password (no echo), generates a TOTP secret, prints a QR you
// scan with any authenticator app (Google Authenticator, 1Password, Authy).

import readline from "node:readline";
import QRCode from "qrcode";
import { findUserByName, createUser } from "./db.mjs";
import { hashPassword, generateTotpSecret, totpKeyUri } from "./auth.mjs";

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (hidden) {
      // Turn off terminal echo during typing
      const stdin = process.stdin;
      const onData = (char) => {
        char = char + "";
        switch (char) {
          case "\n":
          case "\r":
          case "":
            stdin.removeListener("data", onData);
            break;
          default:
            process.stdout.write("[2K[200D" + question + "*".repeat(rl.line.length));
            break;
        }
      };
      stdin.on("data", onData);
    }

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("error", reject);
  });
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: node bootstrap.mjs <username>");
    process.exit(1);
  }
  if (findUserByName(username)) {
    console.error(`User "${username}" already exists. Pick a different username.`);
    process.exit(1);
  }

  const password = await prompt("Password: ", { hidden: true });
  console.log("");
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const totpSecret = generateTotpSecret();
  createUser({ username, passwordHash, totpSecret, role: "admin" });

  const uri = totpKeyUri(username, totpSecret);
  console.log("");
  console.log("User created. Scan this QR with an authenticator app:");
  console.log("");
  console.log(await QRCode.toString(uri, { type: "terminal", small: true }));
  console.log(`Or enter the secret manually: ${totpSecret}`);
  console.log("");
  console.log("Then log in at https://jasons-mac-mini-1.taile58089.ts.net:7686/");
}

main().catch((e) => {
  console.error("bootstrap failed:", e);
  process.exit(1);
});
