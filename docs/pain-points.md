# Big Google Drive downloads: what goes wrong

This is research from October 2026 into what people run into when they move large folders out of Google Drive, and what CosmoDrive does about each problem. Sources: Google Workspace Updates, Adobe Community (Premiere Pro), and troubleshooting write-ups from backup and migration vendors (cbackup, allthings.how, Movebot, Make, fast.io, winhelponline). Reddit couldn't be reached from the build environment, so threads there still need a pass.

| # | What people hit | Why it happens | CosmoDrive |
|---|---|---|---|
| 1 | One download turns into many `drive-download-…-N.zip` files | Drive's web download splits archives at about 2 GB | **Copy to computer** writes the real folder tree. **One zip** streams a single ZIP64 file with no size cap |
| 2 | "Zipping…" never finishes, or finishes and the download never starts | Server-side zipping plus browser cookie and pop-up quirks; large folders and many files (reported around 500+) make it worse | No server-side zipping. Files stream straight from the Drive API |
| 3 | Files silently missing after unzipping, with no list of what came through | Drive gives no manifest, and partial or failed zips are easy to miss | **Cross-check report** after every copy: Drive vs disk, file by file, exportable as CSV |
| 4 | Video plays fine in Drive but freezes or glitches after download (Adobe Community) | Corruption in transfer or upload, with no integrity check | Every file is **checked against Drive's MD5** while it downloads. Corrupted files are retried automatically, and **Check every byte** re-checks a folder later |
| 5 | "Download quota exceeded" on shared files | Google locks popular shared files for about 24 hours | Reported as **Retry later** with that explanation. The rest of the copy continues, and **Fix** retries just those files later |
| 6 | Connection drops during a 20 GB+ file and the browser restarts from zero | The browser download manager can't resume Drive downloads | Reconnects and **resumes from the byte it reached** (HTTP Range) |
| 7 | Google Docs too large to download (about 10 MB export limit through the API) | A Drive API limit | Clear message saying to use File → Download in Google Docs for that file |
| 8 | Owner turned off downloads, or file flagged as abuse | Drive permissions and policy | Reported per file with a plain reason, never as a vague "failed" |
| 9 | "Path too long" when extracting on Windows | Windows Explorer's 260-character limit when unzipping | Copy to computer needs no extraction step. Names are cleaned up for Windows and macOS (`: * ? " < > \|`, reserved names, 200-character cap) |
| 10 | Duplicate file names in one Drive folder overwrite each other | Drive allows duplicates and disks don't | Numbered automatically: `Invoice.pdf`, `Invoice (2).pdf` |
| 11 | Disk fills up partway and everything after that fails | No space check | Stops the whole copy with "Your disk is full". **Resume** keeps everything already copied |
| 12 | Already downloaded with Drive's web zips and not sure it's complete | No tool to compare | **Check a copy**: point at the folder, see what's missing or different, and **Fix** fills only the gaps |

## Ideas for later

- Pre-flight free-space check before starting (needs the desktop app; browsers don't expose free disk space).
- Desktop app (Tauri) so long copies survive closing the tab, and scheduled re-checks.
- "Copy to my Drive first" workaround for quota-locked shared files (needs a write scope).
- A shareable delivery receipt: a PDF of the report for clients ("received 1,204 files, all verified").
