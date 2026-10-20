# BT Unlock — Design

## Intent and why

LG webOS TVs ship with Bluetooth hardware (confirmed via kernel module
`btmtk_usb` and the `webos-bluetooth-service` daemon), but the stock UI only
exposes pairing for LG-branded accessories (Magic Remote, LG soundbars). The
underlying system service — `com.webos.service.bluetooth2` — has a complete,
publicly documented Luna API for generic Bluetooth device discovery,
pairing, and profile connection (HID, A2DP, etc.), but calling it requires
Access Control Group (ACG) permissions that the sandbox denies to normal
apps and to the stock UI.

We proved this works end-to-end on a real device: with root (via Homebrew
Channel), we powered the adapter, discovered a Sony DualShock 4 controller,
paired it, connected it over the HID profile, and confirmed the kernel
exposed it as a standard joystick (`/dev/input/js3`) that reconnects
automatically after a power cycle.

BT Unlock turns that manual `luna-send` recipe into a polished, installable
webOS app so any owner of a rooted webOS TV — not just people comfortable
with SSH — can pair arbitrary Bluetooth accessories (game controllers,
keyboards, mice, headphones/speakers) that LG's own software blocks them
from using. It ships through the Homebrew Channel app repository
(repo.webosbrew.org) for the whole community, with a particular eye toward
older, otherwise-abandoned TVs (webOS 4.x and up) where this capability has
the most value.

## Goals

- Turn the TV's Bluetooth adapter on/off, with the state persisting across
  reboots.
- Discover nearby Bluetooth devices and show them in a remote-navigable
  list (name, signal strength, a device-type icon derived from the
  Bluetooth class-of-device/appearance).
- Pair a selected device, automatically choosing and connecting the right
  profile based on its class: HID (game controllers, keyboards, mice) or
  A2DP (headphones/speakers). Handle the PIN/passkey confirmation flow for
  devices that need it (not just "Just Works" pairing).
- Manage already-paired devices: see connection status, reconnect,
  disconnect, and forget (unpair).
- Work without any computer, SSH, or developer tooling on the user's side —
  install from the Homebrew Channel app store, open the app, done.
- Be distributed as open source, packaged as an installable IPK, and
  published to the default webosbrew repository.

## Non-goals

- Not a general Bluetooth file-transfer (OPP) or phone-pairing (HFP/PBAP)
  tool. Only the profiles that give you a usable accessory (HID, A2DP; LE
  input devices if time allows) are in scope for v1.
- Not a replacement for LG's Magic Remote pairing flow — that continues to
  work as it does today, untouched.
- Not a fork or reimplementation of BlueZ/bluetoothd — the app is a thin,
  friendly front end over the Luna API that `com.webos.service.bluetooth2`
  already exposes.
- Not guaranteed to support every Bluetooth device ever made. Devices that
  need a profile or pairing method we haven't implemented will show a clear
  "unsupported" state rather than silently failing.

## Anti-goals

(Things that would make this a failure even if it technically runs.)

- A blank-screen or silently-stuck UI with no error shown — this is exactly
  the bug we hit and diagnosed in the `webOS Terminal` app on this same TV
  (a React bundle that hung waiting on an async handshake with no
  fallback). BT Unlock must never fail silently: every async operation gets
  a visible timeout and an error state.
- Requiring the user to already know the Luna API, `ssh`, or `luna-send` to
  get value from the app. The whole point is making this accessible to
  people who aren't comfortable with the terminal.
- Breaking or disabling the TV's existing Bluetooth-dependent features
  (Magic Remote, paired soundbar) as a side effect of using the app.

## Constraints

- **Root + Homebrew Channel required.** The `bluetooth.management` and
  `bluetooth.operation` ACGs that gate `com.webos.service.bluetooth2`'s
  pairing/discovery methods are not available to a normal sandboxed app.
  The app's own backend service must run elevated (the same
  `elevate-service` mechanism Homebrew Channel provides to other apps, e.g.
  `webOS Terminal`), the same way the Homebrew Channel service itself runs
  with permanent elevated privileges after `autoroot.sh`.
- **webOS 4.0+ as the supported floor, best-effort below that.** This
  matches Kodi's stated floor on the same repo and the device we tested on
  (webOS 4.0–4.4, SoC `m3`). Older firmware (webOS 1–3) is not excluded
  but isn't tested or guaranteed; the app should degrade to a clear
  "unsupported webOS version" message rather than a blank screen if the
  Luna calls it needs aren't present.
- **1GB RAM / small eMMC class of device** is the baseline hardware
  assumption (matches the TV we built and tested this on) — keep the app
  lightweight; no heavy frameworks, no bundling a UI runtime larger than it
  needs to be.
- Distribution follows the same packaging convention as the rest of the
  repo: an `.ipk` built with `@webos-tools/cli` (not `@webosose/ares-cli`,
  whose `ares-package`/`ares-install` are broken on current Node — we hit
  this directly installing Kodi), submitted via PR to
  `webosbrew/repo.webosbrew.org` following their existing app metadata
  format (same shape as the entries we read for Kodi, RetroArch, etc.).

## Decisions already made (by the builder, during brainstorming)

- **No React / no heavy frontend framework.** Plain HTML/CSS/JS. We
  diagnosed, on this exact TV, a real published webOS app (`webOS
  Terminal`) whose React bundle rendered nothing and threw no errors on
  webOS 4.x — the dual-boot "legacy vs modern" bundle-selection pattern
  that app and others (e.g. `Aerial Screensaver`'s fork of
  `custom-screensaver`) use is itself a sign this class of device needs
  the simpler path, not a fancier fallback. Keeping the UI to vanilla JS
  removes that whole failure class and keeps the install small.
- **Persist the adapter's powered-on state across reboots** using the same
  `/var/lib/webosbrew/init.d/` startup-hook mechanism we used in this
  session to make Homebrew Channel's own root service and the elevated
  `webOS Terminal` service survive a reboot. A script here powers the
  adapter back on and (if we decide to auto-reconnect paired accessories
  rather than relying on each device's own reconnect behavior) issues the
  `hid`/`a2dp` reconnect calls for trusted devices.
- **Device-type detection** uses the Bluetooth class-of-device /
  appearance bitfields already returned by `device/getStatus`
  (`classOfDevice`) to choose an icon and the profile to connect
  (HID vs. A2DP), rather than asking the user to pick a device type
  manually.
- **App name:** BT Unlock.

## What's left to the builder (implementation plan, not yet written)

This design document covers intent and shape. The next step is a
`superpowers:writing-plans` implementation plan covering, at minimum:

- Exact Luna API call sequence per flow (power on, discovery with its
  `device/getStatus` subscription, pairing including the
  `supplyPasskey`/`enterPasskey`/`displayPinCode` request variants, HID
  connect, A2DP connect, disconnect, unpair/`device/setState` or
  equivalent "forget").
- The elevated backend service's shape: what it exposes to the web UI,
  and exactly how `elevate-service` is invoked at install time (mirroring
  what we did by hand for `webOS Terminal`'s service in this session).
- Screen-by-screen UI spec and remote-control input mapping (color buttons,
  D-pad focus order), matching the visual language of other webosbrew
  apps (dark theme, big focusable rows) — no existing mockup was produced
  during brainstorming; the builder should propose one.
- Packaging: `appinfo.json`, service definition, build tooling
  (`@webos-tools/cli`), and the webosbrew repo submission format.
- Test plan: this was only validated manually, once, against one real
  device (DualShock 4 wireless controller) on one real TV (webOS 4.0–4.4,
  SoC `m3`). The implementation plan should call out what else needs
  manual verification (a BT keyboard/mouse for HID-non-gamepad, a
  BT headset/speaker for A2DP, a device that actually requires PIN
  confirmation rather than Just Works) before a first release.
