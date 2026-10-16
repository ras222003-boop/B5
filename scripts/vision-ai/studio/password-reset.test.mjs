import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import {
  hiddenPassword,
  passwordHash,
  resetPassword,
  updateIdentities,
} from "./identities.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { transferPlan } from "../storage.mjs";
import { fileHash } from "../common.mjs";

async function setup(t) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-password-fixture-")),
    root = resolve(temp, "data");
  await fixture(root, { images: 1 });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = resolve(root, ".studio/identities.json"),
    original = await readFile(path);
  return { root, path, original, temp };
}
const prompts =
  (...values) =>
  async () =>
    values.shift();
const newPassword = "synthetic-new-password-26";
async function client(studio, cookie) {
  if (!cookie)
    cookie = (await fetch(studio.url)).headers.get("set-cookie").split(";")[0];
  const get = path => fetch(studio.url + path, { headers: { cookie } });
  const bootstrap = await get("/api/bootstrap");
  const csrf = (await bootstrap.json()).csrf;
  return {
    cookie,
    get,
    login: password =>
      fetch(studio.url + "/api/login", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json",
          "X-Studio-CSRF": csrf,
        },
        body: JSON.stringify({ id: "editor", password }),
      }),
  };
}

test("reset authenticates only the new password after restart, clears locks/sessions and preserves all other data", async t => {
  const { root, path, original } = await setup(t);
  const originalData = JSON.parse(original),
    previous = originalData.users[0];
  const image = resolve(root, "incoming/demo/images/demo-001.png"),
    manifest = resolve(root, "incoming/demo/dataset.review.pending.json");
  await mkdir(resolve(root, ".studio/items"));
  const review = resolve(root, ".studio/items/synthetic-review-evidence.json");
  await writeFile(
    review,
    JSON.stringify({ reason: "fictional preserved review", actor: "reviewer" })
  );
  const video = resolve(
    root,
    "incoming/demo/videos/credential-preservation-fixture.webm"
  );
  await writeFile(
    video,
    Buffer.from(
      "SYNTHETIC preservation sentinel, not a playable training video"
    )
  );
  const hashes = await Promise.all(
    [image, manifest, review, video].map(fileHash)
  );
  let studio = await createStudio(root);
  t.after(() => studio?.close());
  const live = await client(studio);
  assert.equal((await live.login("synthetic-fixture-password")).status, 200);
  const locked = await client(studio);
  for (let i = 0; i < 5; i++)
    assert.equal((await locked.login("synthetic-wrong-password")).status, 400);
  assert.match(
    (await (await locked.login("synthetic-fixture-password")).json()).error,
    /temporarily locked/
  );
  const result = await resetPassword(root, "editor", {
    readPassword: prompts(newPassword, newPassword),
  });
  assert.equal(result.requiresRestart, true);
  assert.deepEqual(await readFile(resolve(root, result.backupPath)), original);
  const updated = JSON.parse(await readFile(path)),
    target = updated.users[0];
  assert.notEqual(target.salt, previous.salt);
  assert.notEqual(target.passwordHash, previous.passwordHash);
  assert.equal(target.passwordHash, passwordHash(newPassword, target.salt));
  assert.deepEqual(updated, {
    ...originalData,
    users: originalData.users.map(u =>
      u.id === "editor"
        ? { ...u, salt: target.salt, passwordHash: target.passwordHash }
        : u
    ),
  });
  assert.deepEqual(
    await Promise.all([image, manifest, review, video].map(fileHash)),
    hashes
  );
  assert.ok(!(await readFile(path, "utf8")).includes(newPassword));
  assert.ok(
    !(await readFile(resolve(root, result.backupPath), "utf8")).includes(
      newPassword
    )
  );
  assert.ok(
    !(await readdir(resolve(root, ".studio"))).some(
      n => n.endsWith(".tmp") || n === "identities.lock"
    )
  );
  // Editing credentials alone cannot revoke process-local state; restart is mandatory.
  assert.match(
    (await (await locked.login(newPassword)).json()).error,
    /temporarily locked/
  );
  assert.equal(
    (await (await live.get("/api/bootstrap")).json()).actor.id,
    "editor"
  );
  const port = studio.server.address().port;
  await studio.close();
  studio = await createStudio(root, { port });
  assert.equal(
    (
      await fetch(studio.url + "/api/bootstrap", {
        headers: { cookie: live.cookie },
      })
    ).status,
    400
  );
  const restarted = await client(studio);
  assert.equal((await restarted.login(newPassword)).status, 200);
  const old = await client(studio);
  assert.equal((await old.login("synthetic-fixture-password")).status, 400);
  assert.match(
    (await (await old.login("synthetic-fixture-password")).json()).error,
    /Invalid credentials/
  );
  if (process.platform === "win32") {
    const script =
      "$a=[System.IO.File]::GetAccessControl($env:BASIRA_TEST_ACL_PATH); $a.AreAccessRulesProtected; ($a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })";
    const allowed = new Set([
      "S-1-5-18",
      "S-1-5-32-544",
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        ],
        { encoding: "utf8", windowsHide: true }
      ).trim(),
    ]);
    for (const p of [path, resolve(root, result.backupPath)]) {
      const lines = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        {
          env: { ...process.env, BASIRA_TEST_ACL_PATH: p },
          encoding: "utf8",
          windowsHide: true,
        }
      )
        .trim()
        .split(/\r?\n/);
      assert.equal(lines.shift(), "True");
      assert.ok(lines.length > 0 && lines.every(sid => allowed.has(sid)));
    }
  } else {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
      (await stat(resolve(root, result.backupPath))).mode & 0o777,
      0o600
    );
  }
  // Backups must remain blocked even when the live registry is not inventoried.
  await rm(path);
  await assert.rejects(
    transferPlan(root, "gcs", "synthetic-private-bucket"),
    /credentials cannot/
  );
});

test("shared atomic writer still supports creating the first account without a prior registry", async t => {
  const { root, path } = await setup(t);
  await rm(path);
  const workspace = await new StudioWorkspace(root).init();
  const account = {
    id: "fictional-first",
    name: "Fictional only",
    roles: ["labels"],
    salt: "synthetic-salt",
    passwordHash: passwordHash(newPassword, "synthetic-salt"),
  };
  const result = await updateIdentities(
    workspace,
    identities => {
      identities.users.push(account);
    },
    { existing: false }
  );
  assert.equal(result.backupPath, null);
  assert.deepEqual(JSON.parse(await readFile(path)), { users: [account] });
  assert.ok(
    !(await readdir(resolve(root, ".studio"))).some(
      n => n.endsWith(".tmp") || n === "identities.lock"
    )
  );
});

test("missing account is rejected before asking for a password; registry is untouched", async t => {
  const { root, path, original } = await setup(t);
  let asked = false;
  await assert.rejects(
    resetPassword(root, "missing-account", {
      readPassword: async () => {
        asked = true;
      },
    }),
    /not found/
  );
  assert.equal(asked, false);
  assert.deepEqual(await readFile(path), original);
  assert.ok(!(await readdir(resolve(root, ".studio"))).includes("credentials"));
});

test("short, too long and mismatched confirmation leave credentials and backups untouched", async t => {
  const { root, path, original } = await setup(t);
  for (const values of [
    ["short"],
    ["😀".repeat(6)],
    ["a".repeat(513)],
    [newPassword, "different-synthetic-password"],
    ["synthetic-fixture-password", "synthetic-fixture-password"],
  ]) {
    await assert.rejects(
      resetPassword(root, "editor", { readPassword: prompts(...values) }),
      /length|confirmation|differ/
    );
    assert.deepEqual(await readFile(path), original);
    assert.ok(
      !(await readdir(resolve(root, ".studio"))).some(
        n => n === "credentials" || n === "identities.lock"
      )
    );
  }
});

test("interrupted prompt and concurrent external edit cannot overwrite credentials", async t => {
  const { root, path, original } = await setup(t);
  await assert.rejects(
    resetPassword(root, "editor", {
      readPassword: async () => {
        throw new Error("synthetic cancellation");
      },
    }),
    /cancellation/
  );
  assert.deepEqual(await readFile(path), original);
  const changed = JSON.parse(original);
  changed.users[1].name = "independent concurrent change";
  let calls = 0;
  await assert.rejects(
    resetPassword(root, "editor", {
      readPassword: async () => {
        if (++calls === 1) await writeFile(path, JSON.stringify(changed));
        return newPassword;
      },
    }),
    /changed concurrently/
  );
  assert.deepEqual(JSON.parse(await readFile(path)), changed);
});

test("credential lock and backup junction prevent replacement", async t => {
  const { root, path, original, temp } = await setup(t);
  const lock = resolve(root, ".studio/identities.lock");
  await writeFile(lock, "");
  await assert.rejects(
    resetPassword(root, "editor", {
      readPassword: prompts(newPassword, newPassword),
    }),
    { code: "EEXIST" }
  );
  await rm(lock);
  const outside = resolve(temp, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    resolve(root, ".studio/credentials"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await assert.rejects(
    resetPassword(root, "editor", {
      readPassword: prompts(newPassword, newPassword),
    }),
    /Links|Reparse/
  );
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(outside), []);
});

test("hidden terminal input does not echo, handles Unicode/backspace and restores terminal on cancellation", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => {
    input.isRaw = value;
  };
  let printed = "";
  output.on("data", bytes => {
    printed += bytes;
  });
  const read = hiddenPassword("Hidden: ", input, output);
  const data = Buffer.from("كلمة-مرور-اصطناعيةx\b\r");
  input.write(data.subarray(0, 1));
  input.write(data.subarray(1));
  assert.equal(await read, "كلمة-مرور-اصطناعية");
  assert.equal(printed, "Hidden: \n");
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount("data"), 0);
  const cancelled = hiddenPassword("Again: ", input, output);
  input.write("synthetic-secret\u0003");
  await assert.rejects(cancelled, /cancelled/);
  assert.equal(input.isRaw, false);
  assert.ok(!printed.includes("synthetic-secret"));
  input.isTTY = false;
  assert.throws(
    () => hiddenPassword("Not shown", input, output),
    /Interactive/
  );
});
