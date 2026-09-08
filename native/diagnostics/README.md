# ROTK Windows diagnostics helper

`ROTK.Diagnostics.exe` is an external x64 Windows crash collector. The launcher
starts it hidden for the exact `H1Z1.exe` PID it launched, drains stdout, and keeps
stdin open while the game runs. It requires the same user/integrity level as the
game. Failure to attach is reported and must never block game launch.

## Build and verification

Zig **0.15.2** is required, matching the existing native build scripts.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-diagnostics.ps1
node --test native/diagnostics/tests/integration.mjs
```

The production build writes `resources/diagnostics/ROTK.Diagnostics.exe` and
`ROTK.Diagnostics.exe.sha256`. Tests compile a separate helper that also accepts
the dedicated `ROTK.Diagnostics.Fixture.exe`; the production executable refuses
that fixture. Test builds cannot overwrite the packaged executable. All test
executables/dumps are kept under the ignored `native/diagnostics/dist/` directory.

Integration tests exercise real Windows debug events and DbgHelp dumps: fatal
access violation, stack overflow, 100 handled exceptions, manual minidump/full
memory dump, standalone snapshot, unexpected process rejection, existing debugger
rejection, clean stdin EOF detachment and forcibly killed helper survival. Dump
headers and streams are inspected, including the real fatal exception code,
exception address, thread context, thread/module/system lists and full-memory
stream. No running player process is used by these tests.

## CLI contract, version 1

```text
ROTK.Diagnostics.exe --watch --pid 1234 --output C:\local\session-directory
ROTK.Diagnostics.exe --snapshot --pid 1234 --output C:\local\session-directory
ROTK.Diagnostics.exe --snapshot --pid 1234 --output C:\local\session-directory --full
```

The caller creates the session directory's parent. Only local fixed-drive output
is accepted. UNC/network output is rejected. `--full` is only valid with the
standalone `--snapshot` mode. For a watch session, stdin accepts simple UTF-8/ASCII
lines terminated by `\n`: `snapshot`, `full`, `stop`. Unknown/oversized commands
are rejected. These are plain lines, not JSON objects. Pipe EOF and Ctrl+C request
clean detachment. The launcher must keep consuming stdout and must not suspend
the helper while debugging is active. Shell quoting is unnecessary when spawned
with an argument array and `windowsHide: true`.

Both stdout and `native-events.jsonl` contain one JSON object per line. Every
object has `event`, `at` (UTC ISO timestamp) and `pid`. Important events:

| Event | Additional fields |
| --- | --- |
| `attached` | `helperVersion`, `architecture`, `killOnExit: false`, `firstChancePolicy` |
| `attach-breakpoint` | `threadId`; the synthetic attach breakpoint was consumed |
| `attach-failed` | `reason`, `win32Error` when supplied by Windows |
| `exception` | `firstChance`, hexadecimal `code`/`address`, `flags`, `threadId`, exception `parameters`, `contextAvailable`, x64 integer `registers` |
| `exception-count` | hexadecimal `code`, cumulative `count` of debug exception notifications |
| `module` | filtered `name`, hexadecimal `base`, four-component `version` |
| `module-unloaded` | hexadecimal `base` |
| `thread-created` / `thread-exited` | `threadId`, start address or exit code |
| `sample` | elapsed milliseconds, process working/private/peak memory, CPU percentage normalized across all logical CPUs, CPU time, handle count, physical memory/commit totals and availability, availability booleans |
| `dump-started` | `kind: "fatal" \| "snapshot"`, `full` |
| `dump-retry` | `kind`, `reason`, original `win32Error` |
| `dump-written` | `kind`, `full`, `path` (**basename only**), `bytes`, `exceptionStream`, actual minidump `flags` |
| `dump-failed` | `kind`, `full`, `reason`, optional `win32Error` or `requiredBytes` |
| `exited` | unsigned decimal `exitCode`, `exitCodeHex`, `elapsedMs`, `fatalDumpCount` |
| `detached` | `success`, `win32Error` |
| `debug-error` / `command-rejected` | `reason`, optional `win32Error` |

Success returns exit code 0; malformed arguments/output returns 2; validation or
attach failure returns 3; standalone dump failure returns 4. The game exit code
is reported in the `exited` event, not used as the helper exit code. Manual
snapshots have no fabricated fatal exception stream. All paths reported over
stdout are basenames or `%WINDIR%` relative names, never user profile paths.

## Evidence and limits

* `DebugActiveProcess` attaches only to the supplied, validated `H1Z1.exe` PID. No
  `SeDebugPrivilege`, elevation, process enumeration, DLL injection, system crash
  registry settings or networking is used.
* Immediately after attach, the same thread calls
  `DebugSetProcessKillOnExit(FALSE)`. An unsuccessful safety call aborts attach.
  Stopping or killing the helper leaves the game running. Debugging can still
  affect timing or interact with anti-cheat/debugger checks, so the launcher must
  expose capture status and support a manual snapshot fallback.
* First-chance exceptions are always continued with
  `DBG_EXCEPTION_NOT_HANDLED`, so the game's own exception handlers run. Only the
  initial synthetic attach breakpoint at the target's `ntdll!DbgBreakPoint`
  address is consumed. Three detailed notifications per exception code are
  recorded, with counters thereafter (64 tracked codes). Fatal second-chance
  exceptions are always recorded and are never swallowed.
* On second chance, the stopped faulting thread's x64 `CONTEXT` and exception
  record are obtained from the debug event and passed to `MiniDumpWriteDump`
  **from this separate process**, with `ClientPointers = FALSE`. This works when
  the game has exhausted its stack. The dump preserves thread contexts/stacks,
  modules, module versions, unload information when Windows provides it, memory
  layout and indirectly referenced memory. Register details are also JSON text.
* Default dumps request `MiniDumpWithThreadInfo`, `MiniDumpWithUnloadedModules`,
  `MiniDumpWithIndirectlyReferencedMemory`, `MiniDumpWithFullMemoryInfo`,
  `MiniDumpScanMemory`, `MiniDumpFilterModulePaths` and
  `MiniDumpIgnoreInaccessibleMemory`. They do not request full heap, handle names,
  security tokens or arbitrary output-debug strings. The raw dump may still
  contain sensitive in-process data. No dump is safe to post publicly merely
  because textual paths were filtered.
* Automatic minidumps use a DbgHelp cancellation callback with a 256 MiB target
  budget and 45-second deadline. A failed rich dump retries once without indirect
  memory/scan flags with a 15-second deadline. These callback checks are best
  effort, not hard kernel-enforced byte/time limits. The parent may impose an
  additional watchdog; it must allow fatal evidence time to finish.
* A manual full dump requires free space greater than all committed target
  regions plus **512 MiB** (committed mapped/shared memory is counted too). It
  captures all accessible game memory, may be several GiB, and uses a 180-second
  best-effort callback deadline. It can reveal tokens, messages or other data in
  game memory and must be explicitly requested/exported by the player. A full
  dump cannot be reconstructed after a process has already exited.
* Every dump uses a unique UTC timestamp/PID/sequence name. A `.partial` file is
  renamed to `.dmp` only on success; incomplete files are deleted on normal
  failure. A forced helper termination may leave `.partial` files, which the
  launcher must not present as completed dumps. Per process: at most ten manual
  successful snapshots, two full dumps and two fatal dumps. Session/report disk
  retention is the launcher's responsibility.
* RAM/CPU/system commit is sampled every five seconds; exception counters every
  30 seconds and at exit. Journal rotation keeps the newest approximately 4 MiB
  and one approximately 4 MiB previous file (`native-events.jsonl.1`). Event size
  can cause a small overshoot. Module and thread event detail is bounded to
  2,048 and 512 events respectively. Module version metadata is only read from
  local fixed-drive files. Missing/unversioned files report `0.0.0.0`.
* Abrupt termination (`TerminateProcess`), power loss, a crash before attach,
  access restrictions, incompatible architecture, a second debugger, or kernel/
  GPU resets may not produce a user-mode fatal exception/dump. Report this gap;
  do not interpret absence of a dump as absence of a crash. Snapshots of a live
  hung process are useful but are not a simultaneous frozen image of all threads.
  Symbols/PDBs matching the exact game/launcher/native build are still required
  to resolve code offsets and recover meaningful source-level call stacks.

## Microsoft references

* [DebugActiveProcess](https://learn.microsoft.com/en-us/windows/win32/api/debugapi/nf-debugapi-debugactiveprocess)
* [DebugSetProcessKillOnExit](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-debugsetprocesskillonexit)
* [MiniDumpWriteDump](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/nf-minidumpapiset-minidumpwritedump)
* [MINIDUMP_EXCEPTION_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ns-minidumpapiset-minidump_exception_information)
* [MINIDUMP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ne-minidumpapiset-minidump_type)
