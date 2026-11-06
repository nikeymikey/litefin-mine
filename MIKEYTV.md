# MikeyTV

MikeyTV is a personal fork of [Litefin](https://github.com/MoazSalem/litefin) by Moaz Salem, licensed under MPL-2.0. It adds MikeyTV branding and theme, plus replies to admin messages.

## Which file goes on which device

| Device | File |
| --- | --- |
| LG TVs on webOS 22 or later | `MikeyTV-<version>-webOS-Modern.ipk` |
| LG TVs on webOS 4.x to 6.x | `MikeyTV-<version>-webOS-Legacy.ipk` |
| Fire TV Stick, Chromecast with Google TV | `MikeyTV-<version>-Android-universal.apk` |
| Jellyfin server | `MikeyTV.Messaging.dll` and `meta.json` from `mikeytv-messaging-plugin` |

## Install on LG TVs with Homebrew Channel

In Homebrew Channel, open Settings, choose **Add repository**, and enter the URL for that TV:

| TV | Repository URL |
| --- | --- |
| webOS 22 or later | `https://raw.githubusercontent.com/nikeymikey/litefin-mine/homebrew/modern.json` |
| webOS 4.x to 6.x | `https://raw.githubusercontent.com/nikeymikey/litefin-mine/homebrew/legacy.json` |

To publish an update, raise the version in `package.json` and `appinfo.json`, then push to the `mikeytv` branch. Homebrew Channel compares versions, so it won't offer a build with the same version as the one installed.

## Install on Fire TV or Google TV

Enter this URL in the Downloader app:

`https://raw.githubusercontent.com/nikeymikey/litefin-mine/homebrew/MikeyTV.apk`

## Install the server plugin

1. Create the folder `plugins/MikeyTV Messaging_1.0.0.0` in Jellyfin's data folder.
2. Copy `MikeyTV.Messaging.dll` and `meta.json` into it.
3. Restart Jellyfin.

Replies appear in the dashboard's Activity log and as a toast on admin web sessions. The plugin has no settings.

## Sign Android builds

Android only installs an update over an earlier version if both use the same key. Create one once and keep it safe:

```bash
keytool -genkeypair -keystore mikeytv.jks -alias mikeytv -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 mikeytv.jks
```

Add these GitHub repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`.

## Merge upstream changes

```bash
git remote add upstream https://github.com/MoazSalem/litefin.git
git fetch upstream
git merge upstream/development
```

Internal names such as `litefin:` storage keys and `/Litefin/*` routes are unchanged on purpose. They keep upstream merges simple and the upstream Litefin plugin working.
