import { pbkdf2Sync, randomBytes } from "node:crypto";
import { stdin, stdout } from "node:process";

function readHiddenPassword() {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal so the password can be hidden.");
  }
  return new Promise((resolve, reject) => {
    let password = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character >= " ") {
          password += character;
        }
      }
    };
    stdout.write("New admin password (minimum 12 characters): ");
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

const password = await readHiddenPassword();
if (password.length < 12) throw new Error("Password must be at least 12 characters.");
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256");
const encode = value => value.toString("base64url");
console.log(`pbkdf2$210000$${encode(salt)}$${encode(hash)}`);
