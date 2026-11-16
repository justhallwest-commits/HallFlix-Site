# Installing HallFlix on a UGREEN NAS

No terminal needed. HallFlix runs beside Jellyfin and does not touch it or your media files.

## 1. Make a folder for HallFlix

In **Files**, inside your `docker` shared folder, create `hallflix`, and inside it two folders: `data` and `db`.

## 2. Create the project

1. Open the **Docker** app, go to **Project**, and press **Create**.
2. Name it `hallflix` and pick the `docker/hallflix` folder as its location.
3. Paste in the contents of [`docker-compose.yml`](docker-compose.yml).
4. Change the two lines marked `<-- CHANGE`. Replace only the part before the first colon with the shared folder that holds
   your movies and shows, and keep `:/media:ro` on the end. For media in `/volume1/Media` the line is `- /volume1/Media:/media:ro`. If your `docker` folder is not on `volume1`, fix those paths too.
5. Press **Deploy**. The first start downloads about 600 MB.

## 3. Set it up

1. Open `http://<your NAS address>:8780` in a browser.
2. Create your admin profile and paste your TMDb key. The key is saved in HallFlix's database, nowhere else.
3. You land in the Studio. Under **Libraries**, press **Add a library**, pick **Movies** and browse to your movies folder.
   Do the same for **Shows**, and for a folder of **Pre-roll clips** if you have one.
4. The first scan starts by itself. Posters appear as titles are matched.

Folder naming that matches best: `Movies/Title (Year)/Title (Year).mkv` and `Shows/Show Name (Year)/Season 01/Show S01E01.mkv`.

## 4. Check the graphics chip

In the Studio, **Overview → Video converter** should say it is using the graphics chip. If it says "Using the processor",
HallFlix still plays everything, but converting 4K files will be slow. Most files play directly and never need converting.

## 5. Point hallflix.net at it (when you are ready)

In Cloudflare Zero Trust, change the tunnel's public hostname for `hallflix.net` from Jellyfin's port to `http://<NAS address>:8780`.
To go back, change it back. Nothing else needs undoing.

## Deleting files from HallFlix (optional)

Admins can always **remove** a title from HallFlix (the trash button on its page). The files stay on the NAS, and
**Studio → Libraries → Removed titles** brings it back.

To also **delete the files from the NAS** from inside HallFlix, give the site container write access to your media:

1. In the Docker app, edit the `hallflix` project.
2. In the `hallflix:` section only, change `- /volume1/Media:/media:ro` to `- /volume1/Media:/media` (drop the `:ro`).
   Leave the `transcoder:` line as it is.
3. Save and redeploy. The title page's trash button now offers **Delete from the NAS**, which lists every file and folder before
   anything is deleted.

Deleted files do not go to the UGREEN recycle bin. If you want a safety net, keep the `:ro` and use **Remove from HallFlix** instead.

## The apps

Every update to the repo builds the apps again. The newest builds are always at these links (use your NAS address):

| Device | Link |
| --- | --- |
| Fire TV, Android TV, Android phones | `http://<NAS address>:8780/get/android` |
| Roku | `http://<NAS address>:8780/get/roku` |

The apps ask for the server address the first time they open: enter `http://<NAS address>:8780` (or your
`https://` address if you set one up in Cloudflare). They use the same profiles, look, seasons and pre-rolls as the website.

### Fire TV

1. **Settings → My Fire TV → About**: click the device name seven times to turn on Developer Options, if it is not on already.
2. **Settings → My Fire TV → Developer Options → Install unknown apps**: turn it on for **Downloader**.
3. Open **Downloader**, type `http://<NAS address>:8780/get/android` and press **Go**. Press **Install** when asked.
4. HallFlix appears in **Your Apps & Channels**. Hold the select button on it and choose **Move** to put it on the home row.

### Samsung or other Android phone

1. Open `http://<NAS address>:8780/get/android` in the phone's browser and download the file.
2. Open the download. If asked, allow the browser to **install unknown apps**, then press **Install**.
   If Play Protect warns about an unknown developer, press **More details → Install anyway**.

### Roku

Roku only installs channels like this through its Developer Mode, one channel at a time.

1. With the Roku remote, press **Home ×3, Up ×2, Right, Left, Right, Left, Right**. Choose **Enable installer and restart**,
   accept, and set a password. Note the address the screen shows (for example `http://192.168.1.50`).
2. On a computer, download `http://<NAS address>:8780/get/roku`.
3. On the same computer, open the Roku's address, sign in as `rokudev` with that password, choose **Upload**, pick
   `hallflix-roku.zip` and press **Install with zip**. HallFlix opens straight away and stays in your channel list.

To update an app, repeat the download (Fire TV and phones install over the old version; Roku replaces it the same way).

### Keeping updates installable

Android only installs an update over the old app when both are signed with the same key. Add two repository secrets on
GitHub (**Settings → Secrets and variables → Actions → New repository secret**): `HALLFLIX_KEYSTORE_B64` and
`HALLFLIX_KEYSTORE_PASSWORD`. Builds made before the secrets existed use a temporary key: uninstall that build once
before installing a signed one. Keep a copy of the key file somewhere safe; without it, future updates need an uninstall.

## Updating

In the Docker app, open the `hallflix` project and press **Redeploy** (pull the newest image). Your database and settings are kept.

## If something goes wrong

- **Deploy fails with "denied" or "unauthorized" while downloading the image:** the image is still private on GitHub. Open the repo on GitHub, click **Packages → hallflix-site → Package settings**, and under **Danger Zone** change the visibility to **Public**. Then deploy again.

- **Page does not open:** in the Docker app, check all three containers are running, and open the `hallflix` container's log.
- **"Folder not found" when adding a library:** the media path in the compose file does not match your share. Fix it and redeploy.
- **Deploy fails mentioning `/dev/dri`:** delete the two `devices:` lines from the compose file and redeploy (software conversion only).
