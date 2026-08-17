import { AnimatePresence, motion } from "framer-motion";
import { Ban, Camera, Copy, FolderOpen, RefreshCw, ScanSearch, ScrollText, SearchCode, ShieldCheck, Wrench, X } from "lucide-react";
import { useState } from "react";
import { TIGHT_KILL_GAP_MS, type DevToolsSnapshot, type KillFeedPlayerSummary, type LauncherSnapshot } from "../../shared/contracts";
import { LAUNCH_PROFILE_IDS } from "../../shared/launch-profile";
import { useI18n } from "../i18n";

interface DevToolsPanelProps {
  snapshot: LauncherSnapshot;
  open: boolean;
  onClose(): void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="devtools-field">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function boolLabel(value: boolean, yes: string, no: string): string {
  return value ? yes : no;
}

export function DevToolsPanel({ snapshot, open, onClose }: DevToolsPanelProps) {
  const { copy } = useI18n();
  const [feedback, setFeedback] = useState<string | null>(null);
  const tools = snapshot.devTools;

  const run = async (operation: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    const result = await operation();
    if (result.ok) setFeedback(success ?? null);
    else setFeedback(result.error ?? copy.devTools.copyFailed);
  };

  return (
    <AnimatePresence>
      {open && tools && (
        <>
          <motion.button
            type="button"
            className="install-panel__backdrop"
            aria-label={copy.devTools.close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="devtools-panel"
            role="dialog"
            aria-label={copy.devTools.panelLabel}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="identity-panel__header">
              <div>
                <p className="devtools-panel__eyebrow">
                  <Wrench size={13} /> {copy.devTools.eyebrow}
                </p>
                <h2>{copy.devTools.title}</h2>
              </div>
              <button type="button" className="panel-close" aria-label={copy.devTools.close} onClick={onClose}>
                <X size={16} />
              </button>
            </header>
            <p className="identity-panel__intro">{copy.devTools.intro}</p>
            <div className="devtools-panel__actions">
              <button
                type="button"
                className="devtools-panel__primary"
                onClick={() => void run(() => window.rotk.copyDevDiagnostics(), copy.devTools.copied)}
              >
                <Copy size={14} /> {copy.devTools.copy}
              </button>
              <button type="button" onClick={() => void run(() => window.rotk.exportDevDiagnostics(), copy.devTools.exported)}>
                <Copy size={14} /> {copy.devTools.exportFile}
              </button>
              <button type="button" onClick={() => void run(() => window.rotk.openUserDataFolder())}>
                <FolderOpen size={14} /> {copy.devTools.openUserData}
              </button>
              <button type="button" onClick={() => void run(() => window.rotk.openLogsFolder())}>
                <ScrollText size={14} /> {copy.devTools.openLogs}
              </button>
              <button type="button" onClick={() => void run(() => window.rotk.openGameLogsFolder())}>
                <ScrollText size={14} /> {copy.devTools.openGameLogs}
              </button>
              <button type="button" onClick={() => void run(() => window.rotk.openSessionsFolder())}>
                <FolderOpen size={14} /> {copy.devTools.openSessions}
              </button>
              <button
                type="button"
                onClick={() => void run(() => window.rotk.captureSessionDossier(), copy.devTools.capturedSession)}
              >
                <Camera size={14} /> {copy.devTools.captureSession}
              </button>
              {!tools.packaged && (
                <>
                  <button type="button" onClick={() => void run(() => window.rotk.openChromiumDevTools())}>
                    <SearchCode size={14} /> {copy.devTools.chromium}
                  </button>
                  <button type="button" onClick={() => void run(() => window.rotk.reloadRenderer())}>
                    <RefreshCw size={14} /> {copy.devTools.reload}
                  </button>
                </>
              )}
              <button type="button" onClick={() => void run(() => window.rotk.revalidateInstall())}>
                <ShieldCheck size={14} /> {copy.devTools.revalidate}
              </button>
              <button
                type="button"
                onClick={() => void run(() => window.rotk.scanCompanionProcesses(), copy.devTools.scannedCompanion)}
              >
                <ScanSearch size={14} /> {copy.devTools.scanCompanion}
              </button>
            </div>
            {feedback && <p className="devtools-panel__feedback">{feedback}</p>}
            {tools.preferTestServer && <p className="devtools-panel__advice">{copy.devTools.preferTestServer}</p>}
            <Overview tools={tools} onFeedback={setFeedback} />
            <LogSection tools={tools} onCleared={() => setFeedback(null)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Overview({ tools, onFeedback }: { tools: DevToolsSnapshot; onFeedback(message: string | null): void }) {
  const { copy } = useI18n();
  const { yes, no } = copy.devTools;
  const health = tools.installHealth;
  return (
    <>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.runtime}</h3>
        <dl>
          <Field label={copy.devTools.fields.version} value={tools.appVersion} />
          <Field label={copy.devTools.fields.electron} value={tools.electronVersion} />
          <Field label={copy.devTools.fields.chrome} value={tools.chromeVersion} />
          <Field label={copy.devTools.fields.node} value={tools.nodeVersion} />
          <Field label={copy.devTools.fields.isolatedData} value={boolLabel(tools.isolatedUserData, yes, no)} />
          <Field label={copy.devTools.fields.vite} value={boolLabel(tools.viteDevServer, yes, no)} />
          <Field label={copy.devTools.fields.server} value={`${tools.runtime.label} (${tools.runtime.serverId})`} />
          <Field label={copy.devTools.fields.role} value={tools.runtime.role} />
          <Field label={copy.devTools.fields.environment} value={tools.runtime.environment} />
          <Field
            label={copy.devTools.fields.assets}
            value={`${tools.assetSync.status}${tools.assetSync.packVersion ? ` · ${tools.assetSync.packVersion}` : ""}`}
          />
          <Field
            label={copy.devTools.fields.launcherUpdate}
            value={tools.launcherUpdate.availableVersion
              ? `${tools.launcherUpdate.status} · ${tools.launcherUpdate.availableVersion}`
              : tools.launcherUpdate.status}
          />
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.security}</h3>
        <dl>
          <Field label={copy.devTools.fields.sandbox} value={boolLabel(tools.security.sandbox, yes, no)} />
          <Field label={copy.devTools.fields.isolation} value={boolLabel(tools.security.contextIsolation, yes, no)} />
          <Field label={copy.devTools.fields.encryption} value={boolLabel(tools.security.encryptionAvailable, yes, no)} />
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.endpoints}</h3>
        <dl>
          <Field label={copy.devTools.fields.website} value={tools.runtime.websiteOrigin} />
          <Field label={copy.devTools.fields.gatewayOrigin} value={tools.runtime.gatewayOrigin} />
          <Field label={copy.devTools.fields.voice} value={tools.runtime.voiceGrantOrigin} />
          <Field label={copy.devTools.fields.login} value={tools.runtime.loginList} />
          <Field label={copy.devTools.fields.ticketUrl} value={tools.runtime.launchTicketUrl} />
          <Field label={copy.devTools.fields.challengeUrl} value={tools.runtime.attestationChallengeUrl} />
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.paths}</h3>
        <dl>
          <Field label={copy.devTools.fields.userData} value={tools.paths.userData} />
          <Field label={copy.devTools.fields.appPath} value={tools.paths.appPath} />
          <Field label={copy.devTools.fields.logsRoot} value={tools.paths.logsRoot} />
          <Field label={copy.devTools.fields.installation} value={tools.paths.installationRoot ?? "—"} />
          <Field label={copy.devTools.fields.realPath} value={tools.paths.installationRealPath ?? "—"} />
          <Field label={copy.devTools.fields.source} value={tools.paths.sourceRoot ?? "—"} />
          <Field label={copy.devTools.fields.destination} value={tools.paths.destinationRoot ?? "—"} />
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.health}</h3>
        <dl>
          <Field label={copy.devTools.fields.marker} value={boolLabel(health.markerPresent, yes, no)} />
          <Field label={copy.devTools.fields.buildId} value={health.markerBuildId ?? "—"} />
          <Field label={copy.devTools.fields.installedAt} value={health.markerInstalledAt ?? "—"} />
          <Field
            label={copy.devTools.fields.matchesConfig}
            value={health.markerMatchesConfig === null ? "—" : boolLabel(health.markerMatchesConfig, yes, no)}
          />
        </dl>
        {health.error && <p className="devtools-panel__empty">{health.error}</p>}
        <ul className="devtools-files">
          {health.files.map((file) => (
            <li key={file.name} data-present={file.present ? "yes" : "no"}>
              {file.name}
            </li>
          ))}
        </ul>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.companion}</h3>
        <p className="devtools-panel__empty">{copy.devTools.companionNote}</p>
        <dl>
          <Field
            label={copy.devTools.fields.scanStatus}
            value={copy.devTools.companionStatus[tools.companionScan.status]}
          />
          <Field label={copy.devTools.fields.scannedAt} value={tools.companionScan.scannedAt ?? "—"} />
          <Field label={copy.devTools.fields.processCount} value={String(tools.companionScan.processCount)} />
          <Field label={copy.devTools.fields.flagCount} value={String(tools.companionScan.flags.length)} />
        </dl>
        {tools.companionScan.error && <p className="devtools-panel__empty">{tools.companionScan.error}</p>}
        {tools.companionScan.flags.length === 0 ? (
          <p className="devtools-panel__empty">{copy.devTools.emptyFlags}</p>
        ) : (
          <ul className="devtools-files">
            {tools.companionScan.flags.map((flag) => (
              <li key={`${flag.pid}-${flag.name}`} data-category={flag.category}>
                {flag.name} · {copy.devTools.companionCategory[flag.category]} · pid {flag.pid}
                {flag.title ? ` · ${flag.title}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <IpBanSection tools={tools} onFeedback={onFeedback} />
      <section className="devtools-section">
        <h3>
          {copy.devTools.sections.killFeed}
          {tools.operatorWatching && <span className="devtools-live">{copy.devTools.live}</span>}
        </h3>
        <p className="devtools-panel__empty">{copy.devTools.killFeedNote}</p>
        {tools.killFeed.kills === 0 ? (
          <p className="devtools-panel__empty">{copy.devTools.emptyKillFeed}</p>
        ) : (
          <>
            <dl>
              <Field label={copy.devTools.fields.kills} value={String(tools.killFeed.kills)} />
              <Field label={copy.devTools.fields.headshots} value={String(tools.killFeed.headshots)} />
            </dl>
            <table className="devtools-killfeed">
              <thead>
                <tr>
                  <th>{copy.devTools.fields.player}</th>
                  <th>{copy.devTools.fields.kills}</th>
                  <th>{copy.devTools.fields.deaths}</th>
                  <th>{copy.devTools.fields.headshots}</th>
                  <th>{copy.devTools.fields.killGap}</th>
                </tr>
              </thead>
              <tbody>
                {tools.killFeed.players.map((player) => (
                  <KillFeedRow key={player.name} player={player} />
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <section className="devtools-section">
        <h3>
          {copy.devTools.sections.combat}
          {tools.operatorWatching && <span className="devtools-live">{copy.devTools.live}</span>}
        </h3>
        <p className="devtools-panel__empty">{copy.devTools.combatNote}</p>
        {tools.combatLogs.map((entry) => (
          <div key={entry.name} className="devtools-combat">
            <h4>
              {entry.name}
              {entry.highlights.length > 0 ? ` · ${entry.highlights.join(" · ")}` : ""}
            </h4>
            {entry.excerpt ? (
              <pre className="devtools-config">{entry.excerpt}</pre>
            ) : (
              <p className="devtools-panel__empty">{copy.devTools.emptyCombat}</p>
            )}
          </div>
        ))}
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.definitions}</h3>
        {tools.definitions.length === 0 ? (
          <p className="devtools-panel__empty">{copy.devTools.emptyDefinitions}</p>
        ) : (
          <ul className="devtools-files">
            {tools.definitions.map((entry) => (
              <li key={entry.name} data-present={entry.name === "CheatReportType" ? "yes" : undefined}>
                {entry.name} · {entry.count}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.launch}</h3>
        <dl>
          <Field label={copy.devTools.fields.phase} value={tools.launch.phase} />
          <Field label={copy.devTools.fields.pid} value={tools.launch.gamePid?.toString() ?? "—"} />
          <Field label={copy.devTools.fields.running} value={boolLabel(tools.launch.gameRunning, yes, no)} />
          <Field label={copy.devTools.fields.canPlay} value={boolLabel(tools.launch.canPlay, yes, no)} />
          <Field label={copy.devTools.fields.updateRequired} value={boolLabel(tools.launch.updateRequired, yes, no)} />
          <Field
            label={copy.devTools.fields.gateway}
            value={tools.launch.sessionGatewayListening ? copy.devTools.listening : copy.devTools.idle}
          />
          <Field
            label={copy.devTools.fields.attestation}
            value={[
              copy.devTools.attestation[tools.launch.attestation.status],
              tools.launch.attestation.reason,
            ].filter(Boolean).join(" — ")}
          />
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.identity}</h3>
        <dl>
          {LAUNCH_PROFILE_IDS.map((profile) => (
            <Field
              key={profile}
              label={profile}
              value={boolLabel(tools.identityConfigured[profile], copy.devTools.yes, copy.devTools.no)}
            />
          ))}
        </dl>
      </section>
      <section className="devtools-section">
        <h3>{copy.devTools.sections.clientConfig}</h3>
        <pre className="devtools-config">{tools.clientConfig ?? "—"}</pre>
      </section>
    </>
  );
}

function formatSeenAt(value: string): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function IpBanSection({
  tools,
  onFeedback,
}: {
  tools: DevToolsSnapshot;
  onFeedback(message: string | null): void;
}) {
  const { copy } = useI18n();
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const remote = tools.operatorRemote;
  const activeBans = [
    ...remote.bans.filter((ban) => ban.active),
    ...tools.operatorIpBans.filter((ban) => ban.active),
  ];
  const remoteNote = remote.status === "ok"
    ? copy.devTools.remoteSessionsNote
    : remote.status === "forbidden"
      ? copy.devTools.remoteSessionsForbidden
      : remote.status === "idle"
        ? copy.devTools.remoteSessionsIdle
        : copy.devTools.remoteSessionsUnavailable;

  const ban = async (target: string, banReason?: string) => {
    const result = await window.rotk.banOperatorIp(target, banReason);
    if (result.ok) {
      setIp("");
      setReason("");
      onFeedback(copy.devTools.bannedIp);
      return;
    }
    onFeedback(result.error ?? copy.devTools.copyFailed);
  };

  return (
    <section className="devtools-section">
      <h3>
        {copy.devTools.sections.remoteSessions}
        {remote.status === "ok" && <span className="devtools-live">{copy.devTools.live}</span>}
      </h3>
      <p className="devtools-panel__empty">{remoteNote}</p>
      {remote.error && remote.status !== "ok" && (
        <p className="devtools-panel__advice">{remote.error}</p>
      )}
      {remote.sessions.length === 0 ? (
        <p className="devtools-panel__empty">{copy.devTools.emptyRemoteSessions}</p>
      ) : (
        <table className="devtools-killfeed">
          <thead>
            <tr>
              <th>{copy.devTools.fields.player}</th>
              <th>{copy.devTools.fields.ip}</th>
              <th>{copy.devTools.fields.seenAt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {remote.sessions.map((entry) => (
              <tr key={`remote-${entry.at}-${entry.loginSessionId}-${entry.ip}`}>
                <td>{entry.name || "—"}</td>
                <td>{entry.ip}</td>
                <td>{formatSeenAt(entry.at)}</td>
                <td>
                  <button
                    type="button"
                    className="devtools-panel__text-action"
                    onClick={() => void ban(entry.ip, reason || `banned ${entry.name || entry.ip}`)}
                  >
                    {copy.devTools.banIp}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{copy.devTools.sections.ipBans}</h3>
      <p className="devtools-panel__empty">{copy.devTools.ipBanNote}</p>
      <p className="devtools-panel__advice">{copy.devTools.ipBanWarning}</p>
      <form
        className="devtools-ip-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ban(ip, reason);
        }}
      >
        <input
          value={ip}
          onChange={(event) => setIp(event.target.value)}
          placeholder={copy.devTools.fields.ip}
          aria-label={copy.devTools.fields.ip}
          autoComplete="off"
          spellCheck={false}
        />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={copy.devTools.fields.banReason}
          aria-label={copy.devTools.fields.banReason}
          autoComplete="off"
        />
        <button type="submit">
          <Ban size={14} /> {copy.devTools.banIp}
        </button>
      </form>
      {tools.operatorConnections.length === 0 ? (
        <p className="devtools-panel__empty">{copy.devTools.emptyConnections}</p>
      ) : (
        <table className="devtools-killfeed">
          <thead>
            <tr>
              <th>{copy.devTools.fields.player}</th>
              <th>{copy.devTools.fields.ip}</th>
              <th>{copy.devTools.fields.seenAt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tools.operatorConnections.map((entry) => (
              <tr key={`${entry.at}-${entry.loginSessionId}-${entry.ip}`}>
                <td>{entry.name || "—"}</td>
                <td>{entry.ip}</td>
                <td>{formatSeenAt(entry.at)}</td>
                <td>
                  <button
                    type="button"
                    className="devtools-panel__text-action"
                    onClick={() => void ban(entry.ip, reason || `banned ${entry.name || entry.ip}`)}
                  >
                    {copy.devTools.banIp}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {activeBans.length === 0 ? (
        <p className="devtools-panel__empty">{copy.devTools.emptyIpBans}</p>
      ) : (
        <ul className="devtools-files">
          {activeBans.map((ban) => (
            <li key={`${ban.ip}-${ban.at}`} data-category="cheat">
              {ban.ip}
              {ban.reason ? ` · ${ban.reason}` : ""}
              {ban.at ? ` · ${formatSeenAt(ban.at)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatKillGap(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function KillFeedRow({ player }: { player: KillFeedPlayerSummary }) {
  const tight = player.minKillGapMs !== null && player.minKillGapMs < TIGHT_KILL_GAP_MS;
  return (
    <tr data-tight={tight ? "yes" : undefined}>
      <td>{player.name}</td>
      <td>{player.kills}</td>
      <td>{player.deaths}</td>
      <td>{player.headshots}{player.kills > 0 ? ` (${player.headshotPercent}%)` : ""}</td>
      <td>{formatKillGap(player.minKillGapMs)}</td>
    </tr>
  );
}

function LogSection({ tools, onCleared }: { tools: DevToolsSnapshot; onCleared(): void }) {
  const { copy } = useI18n();
  return (
    <section className="devtools-section">
      <div className="devtools-section__heading">
        <h3>{copy.devTools.sections.logs}</h3>
        <button
          type="button"
          className="devtools-panel__text-action"
          onClick={() => {
            onCleared();
            void window.rotk.clearDevLogs();
          }}
        >
          {copy.devTools.clearLogs}
        </button>
      </div>
      {tools.logs.length === 0 ? (
        <p className="devtools-panel__empty">{copy.devTools.emptyLogs}</p>
      ) : (
        <ol className="devtools-log">
          {tools.logs.map((entry, index) => (
            <li key={`${entry.at}-${index}`} data-level={entry.level}>
              <time dateTime={entry.at}>{entry.at.slice(11, 19)}</time>
              <span>{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
