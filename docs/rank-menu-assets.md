# BR1315 ranks: coordinated client asset release

The server supplies seasonal ranks and native Top Ten data. A server tag alone
does not repair the distributed menu: its old manager API and shadowing widget
can leave Leaderboards blank. This release installs the compatible UIRoot and
Top Ten widget in all three packs that can supply them. The kill-feed symbols
already exist in the client and are selected by server packets.

`npm run assets:prepare-ranks` packages a **reviewed, prebuilt candidate**; it is
not an arbitrary GFX patcher. It pins the three installed pack sizes/SHA-256s,
streams ZIP creation and complete decompression/readback, then writes both full
manifests. Inputs are read-only and the output directory must not exist.
No client assets are stored in this repository and no production publication
happens when the command runs or this PR merges.

## Relationship to the other PRs

- [Launcher #38](https://github.com/MzKaxD/rotk-launcher/pull/38): the candidate
  retains the native `IsModerator()` gate before opening the O-key admin panel,
  with closing still available. This controls opening the UI; server permissions
  continue to authorize admin actions.
- [Launcher #39](https://github.com/MzKaxD/rotk-launcher/pull/39): the candidate
  retains all four repaired PreGame settings panels. Its `ui_x64_2.pack2` is the
  validated settings pack with only `TrialsTopTenWindow.gfx` replaced.
- [Server #370](https://github.com/MzKaxD/returnoftheking/pull/370), merged as
  `6cba76b5895cb70ca23e395d5846c2cb7f45e564`, supplies the data and reproducible
  rank UI builder. Staff gating, the respawn guard and automatic region selection
  are retained in the input root before the rank transform.

The launcher PRs can be reviewed independently. For deployment, publish the
combined packs once. Publishing #38's main pack or #39's settings-only pack
afterward would remove rank UI changes. Their older standalone release candidates
are not additional files to upload alongside this candidate.

## Reconstruct the candidate from owned inputs

Use Node 22.16.0 for pack transforms, Java 17 and FFDec 26.2.1. The server builder
pins FFDec and the widget. Use the server revision above and #39's source revision
`68f0bd755f0da3af3545379689df3d8b417684f3` for the settings recipe. All intermediate
outputs must be separate staging files, never installed or hardlinked packs.

1. Obtain the published main pack whose installed SHA-256 is
   `b72dcc5245e654e498cadf5493761d63a93fea14904d3da32fda1545ae3d07f3`, and retail
   `ui_x64_0.pack2` (`3a2c7f90b6c75ada48435a9e4499d6a5094f11a8d3d2ea903f690bbaf576d0db`)
   and `ui_x64_2.pack2` (`bee6c209f89a8433e28b19bcf738cd0e99285bd21ae48c3258c4b99e048f60f0`).
   These are operator-owned assets, not files supplied by the PR.
2. Extract `UIRoot.gfx` from the published main pack using the server's
   `devts/tools/pack2-workbench.mjs extract` command. Its SHA-256 must be
   `cdd8d6925a6bfac73bb08335c1f221dc97214d31eee2cbcd4845b3f8cde4a769`.
   Extract the modern `TrialsTopTenWindow.gfx` from retail `ui_x64_2.pack2`;
   the builder requires SHA-256
   `33a76a4e3336b07301e6fef23662c9df2ae3303cca4bf4c692812ed6946a9b21`.
   When extracting, pass `--names names.json` with this minimal name map and
   `--filter '^UIRoot[.]gfx$'` or `--filter '^TrialsTopTenWindow[.]gfx$'`, plus
   a separate `--out` directory:

   ```json
   {"names":{"ef872dad597e632f":"UIRoot.gfx","ee63c2b5aa9adc28":"TrialsTopTenWindow.gfx"}}
   ```
3. From the server repository, run these transforms in order:

   ```sh
   node devts/tools/rotk-admin-host-panel-ui1315.mjs original/UIRoot.gfx stage/staff.gfx
   node devts/tools/rotk-gameplay-ui1315.mjs stage/staff.gfx stage/gameplay.gfx
   node devts/tools/rotk-auto-region-ui1315.mjs stage/gameplay.gfx stage/region.gfx
   node devts/tools/build-rank-menu-client1315.mjs <java> <ffdec.jar> stage/region.gfx original/TrialsTopTenWindow.gfx stage/rank-gfx
   ```

4. Prepare the settings pack with #39's `assets:prepare-menu-settings` command
   and the retail `ui_x64_2.pack2`. Use its generated pack only as an intermediate;
   do not publish its standalone manifests. With Node 22.16.0 its SHA-256 is
   `e44a94cd5d6807dcabc66a323fcee88789e8f479c14d823d1b5ddd613accef43`.
5. Use the server's `pack2-workbench.mjs replace <source> --asset <name>
   --file <GFX> --out <new-pack>` to assemble these outputs. Start from the inputs
   in the table, not an earlier rank staging pack with accumulated edits:

   | Final pack | Input | Replacements, in order |
   | --- | --- | --- |
   | `assets_x64_0.pack2` | Published main pack from step 1 | New `UIRoot.gfx`, then new `TrialsTopTenWindow.gfx`, through two separate output paths |
   | `ui_x64_0.pack2` | Retail pack from step 1 | New `UIRoot.gfx` |
   | `ui_x64_2.pack2` | Settings pack from step 4 | New `TrialsTopTenWindow.gfx` |

   The replacement tool verifies every unaffected asset. Check all three final
   pack hashes against `CANDIDATE` in `scripts/prepare-rank-menu-assets.mjs`.
   Different inputs/tool output require review and revalidation, not bypassing
   the hash checks.

## Package and validate

Put just the three final packs in a staging directory. Fetch the **current full**
`feed.json` and `asset-payloads.v1.json` from `h1z1rotk/assets/main` before preparing
the release. The checked baseline is assets-v1.6.0. Example version 1.7.0 is not
reserved; choose a strictly higher version than the current feed.

```sh
npm ci
npm run assets:prepare-ranks -- <packs-directory> <current-feed.json> <current-payloads.json> <new-output-directory> 1.7.0
npm run test:assets:ranks
```

The output is `assets_x64_0.payload`, `rank_menu_ui.payload`, `feed.json`,
`asset-payloads.v1.json` and `verification.json`. Both `.payload` files are ZIP
containers. Keep their suffix: a conventional `.zip` name is automatically
discovered by the launcher and could activate one pack before the other two.
The main archive contains one pack; the UI archive contains the other two.
Unrelated catalog rows, versions, URLs and hashes remain unchanged.

The tool refuses a changed main pack, existing UI-pack ownership, inconsistent
manifests or a non-increasing version. If #38, #39 or another UI release has already
shipped, reconcile that published release and regenerate/revalidate the candidate
first. Do not overwrite its catalog with a saved v1.6.0 copy.

For an offline test using the actual generated archives, set
`ROTK_RANK_RELEASE_PROOF` to their output directory and run
`npm run test:assets:ranks`. It exercises the production `AssetSyncService` in
an isolated temporary client, with local HTTP responses: three installed hashes,
repeat sync without downloads, same-size corruption repair from verified cache,
and restoration of synthetic originals. It does not modify a real installation.
Allow approximately 7 GB of temporary space for this test.

## Maintainer deployment

1. Deploy server #370 with its normal PostgreSQL configuration in menu and Solo
   roles, role-boundary grants and an active published season including public
   Solo games. Existing eligible results count; fewer than ten means unranked.
2. Upload both `.payload` attachments to the chosen `assets-vX.Y.Z` release in
   `h1z1rotk/assets`. Publish the matching full feed and payload manifests in the
   same assets-repository commit. Uploading attachments alone leaves the old
   per-asset catalog active.
3. Coordinate the effective feed with the server's normal attestation-policy
   publisher, including installed launcher DLLs. Do not change the signed retail
   base manifest or relax integrity enforcement to accept mismatched packs.
4. Synchronize/restart a fresh client. Verify Leaderboards, qualification/Top Ten,
   the current rank, settings pages, O-key staff gating and a public Solo badge.
   No new launcher executable or OVH port is required by this asset update.

Native rank validation used isolated Teuf Admin fixtures: 0/9/10 results,
Royalty V, live refresh and 10-kill row decoration. It did not import fixtures into
production or simulate a completed live two-player ranked match. The native widget
shows current rank and 10/20-kill backgrounds; obsolete rewards are hidden.
End-match promotion animations are outside server #370.

For rollback, restore the prior **paired** feed/payload manifests and matching
integrity policy, retain the old attachments, and verify client synchronization.
Do not combine old root/UI packs with the new widget. Launcher's Restore function
is also covered by the isolated installer test.
