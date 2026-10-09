
# J-Novel Club Crosspoint Plug-In

Download the EPUBs you own on J-Novel Club straight to the reader. This only
fetches volumes already in your library; it does not order books or buy coins.

This plugin has relied on https://github.com/Anpanator/jnc-downloader and uses the same license.

## Set up (once, from a browser)

1. Open the device web page → **Settings** → the J-Novel Club card.
2. Enter your J-Novel Club email and password.
3. Optional: the URL of your EPUB optimizer server ([Matcha-Epub-Optimizer](https://github.com/meguminnet/Matcha-Epub-Optimizer)) and
   the **Optimizer password** it was started with. Leave the URL blank to
   download straight from J-Novel Club.
   **Use the optimizer server** turns the server on or off without clearing
   its URL and password: untick it to download straight from J-Novel Club
   (for example while the server is down), tick it to go back. It takes
   effect right away, on the reader too, without pressing Save.
4. Tap **Test** (it checks the J-Novel Club sign-in, and the optimizer password
   if you set a server), then **Save**.

## Direct or through the optimizer

| | Blank server URL, or the optimizer switched off | With the optimizer server in use |
|---|---|---|
| Downloads from | J-Novel Club | your server, which fetches from J-Novel Club |
| File | the original EPUB | images shrunk, fonts stripped (server settings) |
| Format check | on the reader: none, the first download J-Novel Club lists is saved as-is; from the browser: the EPUB is picked, PDF-only volumes are skipped | only valid EPUBs are delivered; PDF-only volumes are refused |

Without a server, a volume J-Novel Club offers only as a PDF (manga, for
example) could be saved from the reader under an `.epub` name and fail to
open. Sending it from the browser page skips it instead. Only the optimizer
server checks that the file itself is a valid EPUB.

## Use

### On the reader: your whole library, 10 volumes a page

1. On the reader, go to **Plugins → J-Novel Club** (from the home screen).
2. Pick **Latest 10** for your ten newest volumes, or **Older volumes** to page
   through everything else, ten at a time, with **Next page** and
   **Previous page**. Each row shows the volume's full title with its short
   title underneath. Press Confirm (or tap) to download a volume as an EPUB to
   `/J-Novel Club/` on the SD card.

Under each title the reader shows the format of the file it will download:
normally **EPUB**. If it says **PDF** (some manga), J-Novel Club lists the PDF
first and the reader, which always takes the first file, would save a PDF under
an `.epub` name that won't open. Skip those on the reader and use **Send** on
the browser page instead (it picks the EPUB), or use the optimizer server,
which delivers only valid EPUBs.

Hidden series don't apply on the reader. The reader's list is always newest
first and always shows everything; hiding, searching by series and
multi-select are on the browser page (below).

How the paging works: the firmware asks for pages by number, while J-Novel Club
wants "skip this many volumes". With ten volumes a page the skip is the page
number with a zero added (page 2 skips 20), which needs no arithmetic. That
gives the older volumes from the 11th on; **Latest 10** covers the first ten.

### From the browser: your full library

1. On the J-Novel Club card, under **Library**, tap **Load library**.
2. Your volumes are grouped by series. Open a series to see its volumes, in
   order. Volumes already in `/J-Novel Club/` are marked **On the reader**.
3. Search by series or volume name, sort by series name or by most recent
   purchase, or show only volumes that aren't on the reader yet.
4. **Hide this series** tucks away series you don't need; tick **Show hidden
   series** to see them again. This only affects the web page, not the
   reader's list.
5. Tap **Send** on a volume, or tick several (**Select the … not on the
   reader** ticks a whole series' missing volumes) and tap **Send selected**.
   The reader downloads them to `/J-Novel Club/` on the SD card. Keep the page
   open until the status line says they were sent.

## Notes

- If the optimizer server is unreachable, downloads fail; they don't fall back
  to J-Novel Club on their own. Untick **Use the optimizer server** to download
  directly until it's back.
- Through the optimizer, the first download of a volume may take a while
  while the server works; repeats are instant.
- Sign-in only works with an account created directly on J-Novel Club. Accounts
  that log in through Google or Facebook can't use this plugin.
- Preorders and volumes not released yet have nothing to download, so they fail
  with a download error. Through the optimizer, so do volumes J-Novel Club only
  offers in another format (such as PDF), and files that aren't valid EPUBs or
  are unsafe to unpack; nothing is saved.
- After updating the plugin, open the web card once: it updates your saved
  settings for this version (the device can't download until it has). If you
  use a server and see a request for the optimizer password, add it and Save.
- Using a server needs [Matcha-Epub-Optimizer](https://github.com/meguminnet/Matcha-Epub-Optimizer) from the same release or later: older
  servers don't answer the request the plugin now makes.
- Files sent from the browser replace characters the SD card can't store
  (`:` becomes ` -`). The reader's own downloads may name the same volume
  slightly differently; the page still recognizes either as **On the reader**.
- The page's choices (hidden series, sort) are kept in
  `library-prefs.json` in the plugin's folder.
- Your credentials and the optimizer password are stored in plain text on the
  SD card, so keep the card somewhere safe.

## Clear

Tap **Clear** on the web card, or delete `config.json` from the plugin's folder.
