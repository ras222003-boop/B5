import { readFile, open, rename, unlink, chmod } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { StudioWorkspace } from "./workspace.mjs";
import { requireValue as check } from "../common.mjs";

export const passwordHash = (password, salt) =>
  scryptSync(password, salt, 64).toString("hex");

/** Real terminal only: no password arguments, environment variables or echo. */
export function hiddenPassword(
  prompt,
  input = process.stdin,
  output = process.stdout
) {
  check(
    input.isTTY && output.isTTY && typeof input.setRawMode === "function",
    "Interactive PowerShell/terminal required for hidden password entry"
  );
  return new Promise((ok, no) => {
    let value = "",
      finished = false;
    const decoder = new StringDecoder("utf8"),
      wasRaw = !!input.isRaw,
      wasFlowing = input.readableFlowing === true;
    const finish = error => {
      if (finished) return;
      finished = true;
      input.off("data", read);
      input.off("error", failed);
      input.off("end", ended);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
      output.write("\n");
      const result = value;
      value = "";
      if (error) no(error);
      else ok(result);
    };
    const failed = () => finish(new Error("Hidden password entry failed"));
    const ended = () => finish(new Error("Hidden password entry cancelled"));
    const read = chunk => {
      for (const c of decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      )) {
        if (c === "\r" || c === "\n") return finish();
        if (c === "\u0003" || c === "\u0004") return ended();
        if (c === "\u007f" || c === "\b")
          value = Array.from(value).slice(0, -1).join("");
        else if (c.codePointAt(0) >= 32) value += c;
        if (value.length > 512)
          return finish(new Error("Password length must be 12–512"));
      }
    };
    try {
      input.setRawMode(true);
      input.on("data", read);
      input.once("error", failed);
      input.once("end", ended);
      output.write(prompt);
      input.resume();
    } catch {
      failed();
    }
  });
}

export async function confirmedPassword(readPassword = hiddenPassword) {
  let password = await readPassword(
    "New password (12–512 characters; hidden): "
  );
  check(
    typeof password === "string" &&
      Array.from(password).length >= 12 &&
      password.length <= 512,
    "Password length must be 12–512"
  );
  let confirmation = await readPassword("Confirm new password (hidden): ");
  check(password === confirmation, "Password confirmation does not match");
  confirmation = "";
  const result = password;
  password = "";
  return result;
}

// Restrict empty files BEFORE writing credential material. Windows mode=0600
// alone does not restrict inherited ACLs. No secret enters the child process.
export async function protect(path, directory = false) {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const script = `
$ErrorActionPreference = 'Stop'
$targetPath = $env:BASIRA_STUDIO_PRIVATE_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$isDirectory = [System.IO.Directory]::Exists($targetPath)
if ($isDirectory) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($principal in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object System.Security.Principal.SecurityIdentifier($principal)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
  $acl.SetAccessRule($rule)
}
if ($isDirectory) {
  [System.IO.Directory]::SetAccessControl($targetPath, $acl)
} else {
  [System.IO.File]::SetAccessControl($targetPath, $acl)
}
`;
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        env: { ...process.env, BASIRA_STUDIO_PRIVATE_PATH: path },
        windowsHide: true,
        stdio: "pipe",
      }
    );
  } catch {
    throw new Error(
      "Cannot restrict credential file permissions; registry unchanged"
    );
  }
}

export async function privateWrite(workspace, relativePath, bytes) {
  const path = await workspace.safe(relativePath, true);
  const fd = await open(path, "wx", 0o600);
  try {
    await protect(path);
    await fd.writeFile(bytes);
    await fd.sync();
  } finally {
    await fd.close();
  }
  return path;
}

/** Shared with --add-user: serialize CLI edits and replace on the same volume.
 * Never delete the current registry to make rename succeed on Windows.
 */
export async function updateIdentities(
  workspace,
  mutate,
  { existing = true } = {}
) {
  const lockPath = await workspace.safe(".studio/identities.lock", true);
  const lock = await open(lockPath, "wx", 0o600);
  let tempPath;
  try {
    const path = await workspace.safe(".studio/identities.json", !existing);
    let original;
    try {
      original = await readFile(path);
    } catch (e) {
      if (e.code !== "ENOENT" || existing) throw e;
    }
    check(
      !original || original.length < 20_000_000,
      "Identity registry too large"
    );
    let identities;
    try {
      identities = original
        ? JSON.parse(original.toString("utf8"))
        : { users: [] };
    } catch {
      throw new Error("Invalid identity registry JSON; no change made");
    }
    check(
      identities &&
        Array.isArray(identities.users) &&
        identities.users.every(u => u && typeof u.id === "string") &&
        new Set(identities.users.map(u => u.id)).size ===
          identities.users.length,
      "Invalid identity registry; resolve duplicate or missing IDs first"
    );
    await mutate(identities);
    const bytes = Buffer.from(JSON.stringify(identities, null, 2) + "\n");
    const unchanged = async () => {
      const currentPath = await workspace.safe(
        ".studio/identities.json",
        !original
      );
      let current;
      try {
        current = await readFile(currentPath);
      } catch (e) {
        if (e.code !== "ENOENT" || original) throw e;
      }
      check(
        original ? current?.equals(original) : !current,
        "Identity registry changed concurrently; retry without overwriting it"
      );
    };
    await unchanged();
    let backupPath = null;
    if (original) {
      await protect(await workspace.ensure(".studio/credentials"), true);
      backupPath = `.studio/credentials/identities-${Date.now()}-${randomBytes(12).toString("hex")}.json`;
      await privateWrite(workspace, backupPath, original);
      check(
        (await readFile(await workspace.safe(backupPath))).equals(original),
        "Credential backup verification failed; registry unchanged"
      );
    }
    const tempRelative = `.studio/identities.json.${randomBytes(16).toString("hex")}.tmp`;
    // Record path before the write so partial/permission failures are cleaned up.
    tempPath = await workspace.safe(tempRelative, true);
    await privateWrite(workspace, tempRelative, bytes);
    await unchanged();
    await rename(
      tempPath,
      await workspace.safe(".studio/identities.json", !original)
    );
    tempPath = undefined;
    return { backupPath, requiresRestart: true };
  } finally {
    try {
      if (tempPath)
        await unlink(tempPath).catch(e => {
          if (e.code !== "ENOENT") throw e;
        });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

export async function resetPassword(
  root,
  id,
  { readPassword = hiddenPassword } = {}
) {
  check(
    typeof id === "string" && /^[a-z0-9_-]{3,40}$/.test(id),
    "--reset-password requires an existing lowercase account ID"
  );
  const workspace = await new StudioWorkspace(root).init();
  const result = await updateIdentities(workspace, async identities => {
    const user = identities.users.find(u => u.id === id);
    check(
      user,
      "Local account not found; no password was requested or changed"
    );
    let password = await confirmedPassword(readPassword);
    check(
      typeof user.salt !== "string" ||
        typeof user.passwordHash !== "string" ||
        passwordHash(password, user.salt) !== user.passwordHash,
      "New password must differ from the current password"
    );
    const salt = randomBytes(32).toString("hex");
    user.passwordHash = passwordHash(password, salt);
    user.salt = salt;
    password = "";
  });
  return { id, ...result };
}
