
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
4. Tap **Test** (it checks the J-Novel Club sign-in, and the optimizer password
   if you set a server), then **Save**.

## Direct or through the optimizer

| | Blank server URL | With an optimizer server |
|---|---|---|
| Downloads from | J-Novel Club | your server, which fetches from J-Novel Club |
| File | the original EPUB | images shrunk, fonts stripped (server settings) |
| Format check | none: the first download J-Novel Club lists is saved as-is | only valid EPUBs are delivered; PDF-only volumes are refused |

Without a server, a volume J-Novel Club offers only as a PDF (manga, for
example) could be saved under an `.epub` name and fail to open. The optimizer
server is what guarantees EPUB-only downloads.

## Use

1. On the reader, go to **Plugins → J-Novel Club** (from the home screen).
2. Your library is listed, 12 volumes per page. Each row shows the volume's
   full title with its short title underneath, so volumes of a long-named
   series stay easy to tell apart, and the two-line rows are easier to tap.
   Page with the **Previous page** / **Next page** rows, and press Confirm (or
   tap) to download a volume as an EPUB to `/J-Novel Club/` on the SD card.

## Notes

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
- Your credentials and the optimizer password are stored in plain text on the
  SD card, so keep the card somewhere safe.

## Clear

Tap **Clear** on the web card, or delete `config.json` from the plugin's folder.
