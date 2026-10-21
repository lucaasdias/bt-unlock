<div align="center">

# BT Unlock

**Pair, connect, and manage Bluetooth accessories on a rooted LG webOS TV —
the ones the stock TV UI won't even show you.**

</div>

> Screenshot coming soon — a real on-device screenshot still needs to be
> added here by hand (see [Screenshots](#screenshots) below).

---

LG's own webOS Bluetooth settings only expose a narrow set of "approved"
accessories. Plenty of perfectly good hardware — game controllers,
keyboards, mice, headphones and speakers — either doesn't show up in that
UI at all, or shows up and refuses to connect. **BT Unlock** talks to the
same Bluetooth stack LG's own settings app uses, just without the
artificial allow-list, so you can pair and use whatever you actually own,
directly from the remote, no SSH or computer required.

## Features

| Screen | What it does |
|---|---|
| **Status** | Shows whether the Bluetooth adapter is on, turns it on with one click, and — if a Magic Remote is in play — warns you before turning it off. Also hosts the "start on boot" toggle and a built-in log viewer for troubleshooting. |
| **Discover** | Scans for nearby devices, classifies each one (gamepad / keyboard / mouse / audio / unsupported) from its Bluetooth class-of-device, and pairs + connects it over the right profile (HID or A2DP) in one step. |
| **Paired** | Lists every paired device with its live connection state, and lets you disconnect, reconnect, or forget it — forgetting always disconnects first, so nothing is left dangling. |
| **Settings** | Manual language override (pt-BR / en / es) and a QR code linking to help/support, for when the remote isn't the easiest way to type something. |

## Requirements

- **webOS 4.0 or newer.**
- **A rooted TV with [Homebrew Channel](https://www.webosbrew.org/) installed.** BT Unlock does every privileged Bluetooth operation through Homebrew Channel's elevated `exec` service — it never ships or requests its own root access, and it won't work without Homebrew Channel already set up.
- A Bluetooth accessory that speaks classic HID (keyboards, mice, most gamepads) or A2DP (headphones/speakers). BLE-only controllers (e.g. some Xbox Wireless Controllers) are a known current limitation — see [FAQ](#faq).

### Tested device

| | |
|---|---|
| Model | LG 43LK5750PSA |
| webOS release | 4.4.3-22 ("goldilocks-gorongosa") |
| SoC family | M3 (ARM Cortex-A53, armv7l) |

BT Unlock has only been verified against the device above so far. It
should work on any webOS 4.0+/Homebrew-Channel-rooted TV, but if you try
it on different hardware, reports of what did or didn't work are welcome.

## Install

1. Install [Homebrew Channel](https://www.webosbrew.org/) on your TV, if you haven't already.
2. Download the latest `.ipk` from this repo's [Releases](../../releases) page (once published).
3. Sideload it either:
   - from the TV itself, via Homebrew Channel's own app installer, or
   - from a computer on the same network, with [`@webos-tools/cli`](https://github.com/webos-tools/cli):
     ```sh
     ares-install -d <your-tv-device-name> org.lucaasdias.btunlock_<version>_all.ipk
     ```
4. Launch **BT Unlock** from the TV's app launcher.

## Design doc

The full design rationale — architecture decisions, the Luna API calls
used, the class-of-device classification table, and known limitations —
lives in [`docs/superpowers/specs/2026-10-20-bt-unlock-design.md`](docs/superpowers/specs/2026-10-20-bt-unlock-design.md).

## FAQ

**Why do I need root / Homebrew Channel?**
Pairing, connecting, and forgetting Bluetooth devices on webOS requires
Luna Bus calls that normal (non-root) apps aren't allowed to make. Rather
than asking for its own elevated permissions, BT Unlock routes every one
of those calls through Homebrew Channel's already-elevated `exec`
service, so it needs nothing beyond what Homebrew Channel itself needs.

**Does this work on my TV?**
If it's webOS 4.0 or newer and has Homebrew Channel installed, almost
certainly yes — the Bluetooth2 Luna service this app relies on has been
stable across that range. Only one specific model (above) has been
tested end-to-end so far, though.

**What if my controller or accessory isn't found, or won't connect?**
Make sure the adapter is on (Status screen) and the accessory is in
pairing mode. If it shows up in Discover but is greyed out / skipped,
its Bluetooth class-of-device doesn't map to a supported profile (HID or
A2DP) — this is a known, intentional limitation, not a bug. BLE-only
gamepads (some Xbox controllers) are a known gap: classic HID pairing
hangs for them, since they don't speak classic HID. PIN/passkey-based
pairing (anything that isn't "Just Works") also has no UI yet.

**Is this safe to use?**
BT Unlock never touches the system (squashfs) partition and never writes
outside `/var/lib/webosbrew/` and `/tmp`. The optional "start on boot"
feature installs a symlink under `/var/lib/webosbrew/init.d/`, which you
can disable from the Status screen at any time.

## Screenshots

Not included yet. If you'd like to contribute a few (Status, Discover,
Paired, Settings) from a real device, a pull request is welcome.

## License

MIT — see [`LICENSE`](LICENSE).
