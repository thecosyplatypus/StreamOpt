# StreamOpt

![Version](https://img.shields.io/badge/version-0.1.0--beta-c084fc)
![Platform](https://img.shields.io/badge/platform-windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-43-blue)

**Viewer decay analyzer for Twitch streamers.** Track live viewer counts during your stream and find the optimal time to stop based on audience retention.

## How it works

StreamOpt records viewer counts every 60 seconds, groups them into 30-minute segments, and calculates a retention curve. You set a threshold — *"stop when viewers drop to 50% of my peak"* — and the app shows exactly when to end the stream.

## Features

- **Live tracking** — polls Twitch API every 60s, builds a viewer decay curve in real time
- **VOD analysis** — fetch past VODs for any channel and analyze retention patterns
- **Knee detection** — automatically finds where viewer retention drops below your threshold
- **6-hour minimum** — no premature recommendations; floor of 6 hours before suggesting a stop
- **Visual chart** — purple viewer bars + green retention line + red optimal stop marker

## Download

Grab the latest installer from the [Releases](https://github.com/thecosyplatypus/StreamOpt/releases) page.

## Quick start (from source)

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Twitch Client ID + Secret](https://dev.twitch.tv/console) (free, register an app)

### Setup

```bash
# Clone the repo
git clone https://github.com/thecosyplatypus/StreamOpt.git
cd StreamOpt

# Install dependencies
npm install

# Launch the app
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
2. Enter a channel name → Fetch VODs (or just Start Tracking)
3. Set your retention threshold (default: 50% of peak viewers)
4. Click Analyze or start live tracking
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
