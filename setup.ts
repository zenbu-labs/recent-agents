#!/usr/bin/env bun
/**
 * recent-agents setup script.
 *
 * Runs via the cached bun binary (`~/Library/Caches/Zenbu/bin/bun`) when the
 * runtime detects `setup.version` in `zenbu.plugin.json` has advanced past
 * what's recorded in `~/.zenbu/.internal/plugin-setup-state.json` for this
 * plugin.
 *
 * Idempotent — every step reads state first and no-ops when satisfied.
 */

import { $ } from "bun"
import fs from "node:fs"
import { promises as fsp } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = SCRIPT_DIR

const stepStart = (id: string, label: string) =>
  console.log(`##ZENBU_STEP:start:${id}:${label}`)
const stepDone = (id: string) => console.log(`##ZENBU_STEP:done:${id}`)
const stepError = (id: string, msg: string) =>
  console.log(`##ZENBU_STEP:error:${id}:${msg}`)
const logDo = (s: string) => console.log(`  → ${s}`)
const logOk = (s: string) => console.log(`  ✓ ${s}`)

async function ensureTsconfigLocal(): Promise<void> {
  const packagesDir = path.resolve(PLUGIN_ROOT, "..", "zenbu", "packages")
  const registryDir = path.resolve(PLUGIN_ROOT, "..", "..", "registry")
  const tsconfig = path.join(PLUGIN_ROOT, "tsconfig.local.json")
  const expected =
    JSON.stringify(
      {
        compilerOptions: {
          paths: {
            "@testbu/*": [`${packagesDir}/*`],
            "#registry/*": [`${registryDir}/*`],
          },
        },
      },
      null,
      2,
    ) + "\n"
  try {
    const current = await fsp.readFile(tsconfig, "utf8")
    if (current === expected) {
      logOk("tsconfig.local.json up-to-date")
      return
    }
  } catch {}
  await fsp.writeFile(tsconfig, expected)
  logOk("wrote tsconfig.local.json")
}

async function ensureDeps(): Promise<void> {
  // Always let pnpm decide what to do — it's already idempotent and fast
  // when the lockfile and node_modules are in sync. Any custom "is dep X
  // installed?" heuristic we add here gets stale the moment a new dep
  // lands.
  logDo("installing recent-agents deps")
  const pnpmBin = path.join(
    process.env.HOME ?? "",
    "Library",
    "Caches",
    "Zenbu",
    "bin",
    "pnpm",
  )
  const pnpm = fs.existsSync(pnpmBin) ? pnpmBin : "pnpm"
  const proc = Bun.spawn([pnpm, "install"], {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "inherit", "inherit"],
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`pnpm install exited with code ${exit}`)
}

async function runStep(
  id: string,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  stepStart(id, label)
  try {
    await fn()
    stepDone(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stepError(id, msg)
    process.exit(1)
  }
}

async function main(): Promise<void> {
  process.chdir(PLUGIN_ROOT)
  await runStep(
    "tsconfig",
    "Configuring tsconfig.local.json",
    ensureTsconfigLocal,
  )
  await runStep("deps", "Installing recent-agents deps", ensureDeps)
  console.log("\n##ZENBU_STEP:all-done")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
