# StreamOpt

![Version](https://img.shields.io/badge/version-0.2.0--beta-c084fc)
![Platform](https://img.shields.io/badge/platform-windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-43-blue)

**Viewer decay analyzer for Twitch streamers.** Track live viewer counts during your stream and find the optimal time to stop based on audience retention.

## How it works

StreamOpt polls the Twitch API every 60 seconds while you stream, recording viewer counts and grouping them into 30-minute segments. It calculates a retention curve based on your peak audience, then finds the point where viewership drops below your threshold. The result: a clear recommendation for when to end the stream.

## Features

- **Live tracking** — polls Twitch API every 60s, builds a viewer decay curve in real time
- **VOD analysis** — fetch past VODs for any channel and analyze their retention patterns
- **Configurable threshold** — set the retention % at which you want to stop (e.g., 50% of peak)
- **Configurable min duration** — choose the minimum stream length before the app suggests stopping (1–12h, default 6h)
- **Knee detection** — automatically finds where viewer retention drops below your threshold
- **Visual chart** — purple viewer bars + green retention line + red optimal stop marker
- **Live replay** — after stopping, your tracking data stays as a replay VOD for continued analysis

## Download

Grab the latest installer from the [Releases](https://github.com/thecosyplatypus/StreamOpt/releases) page.

## Quick start (from source)

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Twitch Client ID + Secret](https://dev.twitch.tv/console) (free, register an app)

### Setup

```bash
git clone https://github.com/thecosyplatypus/StreamOpt.git
cd StreamOpt
npm install
npm start
```

### Get your Twitch API credentials

1. Go to https://dev.twitch.tv/console
2. Click "Register Your Application"
3. Set OAuth Redirect URL to `http://localhost`
4. Copy the **Client ID** and generate a **Client Secret**
5. Paste both into StreamOpt's left panel and click **Connect**

## Usage

```
1. Paste Client ID + Secret → Connect
2. Enter a channel name → Start Tracking (live) or Fetch VODs (past streams)
3. Set your retention threshold (default: 50% of peak viewers)
4. Set your min stream duration (default: 6h)
5. Watch the chart update live during your stream
```

The chart shows:
- **Purple bars** — viewers per 30-minute segment
- **Green dashed line** — viewer retention as % of peak
- **Red marker** — optimal stop time based on your threshold

## Build an installer

```bash
npm run dist
```

Creates a Windows installer in the `release/` directory.

## Tech stack

- **Electron** — cross-platform desktop shell
- **Twitch Helix API** — live stream data and VOD metadata
- **Canvas API** — zero-dependency chart rendering

## License

MIT
